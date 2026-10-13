-- Phase 7: analysis tool requests (K-12, K-12.6).

-- One row per form submission. The report link token is stored only as a hash; the email is personal data
-- (consent recorded) and is cleared by the retention job once the report link has expired.
create table public.tool_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_id uuid,
  email text check (email is null or length(email) <= 200),
  query text not null check (length(query) between 2 and 200),
  consent_at timestamptz not null,
  consent_version text not null,
  token_hash text not null,
  status text not null default 'queued' check (status in ('queued', 'ready', 'failed')),
  report jsonb,
  mailed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (tenant_id, token_hash),
  foreign key (company_id, tenant_id) references public.companies (id, tenant_id) on delete set null (company_id)
);
create index tool_requests_day_idx on public.tool_requests (tenant_id, created_at desc);

alter table public.tool_requests enable row level security;
create policy tool_requests_tenant_rw on public.tool_requests for all to authenticated
  using (app.can_access_tenant(tenant_id)) with check (app.can_access_tenant(tenant_id));
create trigger tool_requests_audit after insert or update or delete on public.tool_requests
  for each row execute function app.audit_row_change();
revoke all on public.tool_requests from anon;

-- K-13.11 client portal: infrastructure only, behind the `client_portal` flag (off by default).
-- A portal user is linked to exactly one project; they are not tenant members, so every table stays closed
-- to them by RLS. Their only door is app.portal_project(), which returns nothing while the flag is off.
create table public.client_users (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id),
  foreign key (project_id, tenant_id) references public.projects (id, tenant_id) on delete cascade
);
alter table public.client_users enable row level security;
create policy client_users_tenant_rw on public.client_users for all to authenticated
  using (app.can_access_tenant(tenant_id)) with check (app.can_access_tenant(tenant_id));
create trigger client_users_audit after insert or update or delete on public.client_users
  for each row execute function app.audit_row_change();
revoke all on public.client_users from anon;

create function app.portal_project()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cu public.client_users;
begin
  select * into cu from public.client_users where user_id = auth.uid();
  if not found then
    return null;
  end if;
  if not coalesce((select f.enabled from public.feature_flags f
                   where f.tenant_id = cu.tenant_id and f.key = 'client_portal'), false) then
    raise exception 'client portal is disabled' using errcode = '42501';
  end if;
  -- Only what the client should see about their own project: no internal notes, prompts or other clients.
  return (
    select jsonb_build_object(
      'name', p.name,
      'status', p.status,
      'started_on', p.started_on,
      'contract_end', p.contract_end,
      'tasks', coalesce((select jsonb_agg(jsonb_build_object('title', t.title, 'done', t.done) order by t.position)
                         from public.project_tasks t where t.project_id = p.id), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(jsonb_build_object('kind', y.kind, 'amount_kurus', y.amount_kurus,
                                     'due_on', y.due_on, 'status', y.status, 'payment_link', y.payment_link)
                                   order by y.due_on desc)
                            from public.payments y where y.project_id = p.id and y.status <> 'cancelled'), '[]'::jsonb),
      'metrics', coalesce((select jsonb_agg(jsonb_build_object('period', m.period, 'metrics', m.metrics)
                                   order by m.period desc)
                           from public.module_metrics m where m.project_id = p.id), '[]'::jsonb)
    )
    from public.projects p
    where p.id = cu.project_id and p.tenant_id = cu.tenant_id
  );
end;
$$;
revoke all on function app.portal_project() from public;
grant execute on function app.portal_project() to authenticated;

-- K-17.7 data retention and deletion. Firm-level business data and counts stay; people's data goes.
alter table public.companies add column personal_data_cleared_at timestamptz;

-- Clears one company's personal data. With p_suppress, every address is also put on the global
-- suppression list first (one-click deletion), so the company is never contacted again.
create function app.clear_personal_data(p_tenant_id uuid, p_company_id uuid, p_suppress boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if p_suppress then
    for r in
      select 'email' as kind, e as value from public.contacts c, unnest(array[c.email]) e
        where c.tenant_id = p_tenant_id and c.company_id = p_company_id and e is not null
      union select 'phone', c.phone_e164 from public.contacts c
        where c.tenant_id = p_tenant_id and c.company_id = p_company_id and c.phone_e164 is not null
      union select 'instagram', c.instagram_handle from public.contacts c
        where c.tenant_id = p_tenant_id and c.company_id = p_company_id and c.instagram_handle is not null
      union select 'email', e from public.companies co, unnest(co.emails) e
        where co.tenant_id = p_tenant_id and co.id = p_company_id
      union select 'phone', co.phone_e164 from public.companies co
        where co.tenant_id = p_tenant_id and co.id = p_company_id and co.phone_e164 is not null
      union select 'company', co.id::text from public.companies co
        where co.tenant_id = p_tenant_id and co.id = p_company_id
    loop
      perform app.suppress(p_tenant_id, r.kind, r.value, 'data_deletion', p_reason);
    end loop;
  end if;

  delete from public.contacts where tenant_id = p_tenant_id and company_id = p_company_id;
  update public.touches set recipient = null, body = null, subject = null
    where tenant_id = p_tenant_id and company_id = p_company_id;
  update public.inbox_messages set from_address = null, subject = null, body = '[silindi]'
    where tenant_id = p_tenant_id and company_id = p_company_id;
  update public.meetings set notes_raw = null where tenant_id = p_tenant_id and company_id = p_company_id;
  update public.tool_requests set email = null where tenant_id = p_tenant_id and company_id = p_company_id;
  update public.companies
    set emails = '{}', phone_e164 = null, instagram_handle = null, personal_data_cleared_at = now()
    where tenant_id = p_tenant_id and id = p_company_id;
  insert into public.company_events (tenant_id, company_id, kind, summary)
    values (p_tenant_id, p_company_id, 'personal_data_cleared',
            case when p_suppress then 'Kişisel veriler silindi ve iletişim listesinden çıkarıldı'
                 else 'Saklama süresi doldu; kişisel veriler silindi' end);
end;
$$;
revoke all on function app.clear_personal_data(uuid, uuid, boolean, text) from public;
grant execute on function app.clear_personal_data(uuid, uuid, boolean, text) to service_role;

-- Panel "tek tık veri sil": tenant members only (aal2 via can_access_tenant).
create function app.delete_company_personal_data(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t uuid;
begin
  select tenant_id into t from public.companies where id = p_company_id;
  if t is null or not app.can_access_tenant(t) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform app.clear_personal_data(t, p_company_id, true, 'panel');
  -- K-2.5: the record still has a next step: closed (a won client keeps its project).
  update public.companies
    set stage = 'closed', next_step_kind = 'closed', assigned_playbook = null
    where id = p_company_id and stage <> 'won';
  update public.enrollments set status = 'stopped'
    where company_id = p_company_id and status = 'active';
end;
$$;
revoke all on function app.delete_company_personal_data(uuid) from public;
grant execute on function app.delete_company_personal_data(uuid) to authenticated, service_role;

-- Daily job: unwon companies with no contact for `p_months` lose their personal data; expired report
-- links lose their email. Returns the number of companies cleared.
create function app.run_retention(p_tenant_id uuid, p_months integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz := now() - make_interval(months => p_months);
  c record;
  n integer := 0;
begin
  for c in
    select co.id from public.companies co
    where co.tenant_id = p_tenant_id
      and co.stage <> 'won'
      and co.personal_data_cleared_at is null
      and co.created_at < cutoff
      and not exists (select 1 from public.projects p where p.company_id = co.id)
      and not exists (select 1 from public.touches t
                      where t.company_id = co.id and coalesce(t.sent_at, t.created_at) >= cutoff)
      and not exists (select 1 from public.inbox_messages m
                      where m.company_id = co.id and m.received_at >= cutoff)
      and not exists (select 1 from public.meetings m where m.company_id = co.id and m.created_at >= cutoff)
      and (exists (select 1 from public.contacts k where k.company_id = co.id)
           or cardinality(co.emails) > 0 or co.phone_e164 is not null)
    limit 200
  loop
    perform app.clear_personal_data(p_tenant_id, c.id, false, 'retention');
    n := n + 1;
  end loop;
  update public.tool_requests set email = null
    where tenant_id = p_tenant_id and email is not null and expires_at < now();
  return n;
end;
$$;
revoke all on function app.run_retention(uuid, integer) from public;
grant execute on function app.run_retention(uuid, integer) to service_role;
