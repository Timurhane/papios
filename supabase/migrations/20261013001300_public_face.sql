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
