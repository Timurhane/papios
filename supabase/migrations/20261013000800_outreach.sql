-- Phase 3: playbook enrollments, touches (every contact attempt), inbox, and the suppression gate.

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_id uuid not null,
  contact_id uuid,
  playbook_id uuid not null,
  status text not null default 'active' check (status in ('active', 'paused', 'stopped', 'completed')),
  stop_reason text,
  started_at timestamptz not null default now(),
  anchor_date date,
  next_position smallint not null default 1,
  updated_at timestamptz not null default now(),
  foreign key (company_id, tenant_id) references public.companies (id, tenant_id) on delete cascade,
  foreign key (playbook_id, tenant_id) references public.playbooks (id, tenant_id) on delete cascade,
  unique (id, tenant_id)
);
-- One active run per company and playbook.
create unique index enrollments_active_uniq on public.enrollments (tenant_id, company_id, playbook_id) where status = 'active';
create index enrollments_active_idx on public.enrollments (tenant_id, status);
create trigger enrollments_touch before update on public.enrollments
  for each row execute function app.touch_updated_at();

create table public.touches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_id uuid not null,
  contact_id uuid,
  enrollment_id uuid,
  step_position smallint,
  channel public.channel not null,
  -- recipient address for the channel: email, E.164 phone, instagram handle, profile URL
  recipient text,
  subject text,
  body text,
  status text not null default 'drafted'
    check (status in ('drafted', 'awaiting_approval', 'approved', 'scheduled', 'ready', 'sent', 'skipped', 'cancelled', 'failed')),
  skip_reason text,
  approval_id uuid references public.approvals (id),
  due_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  thread_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, tenant_id) references public.companies (id, tenant_id) on delete cascade,
  foreign key (enrollment_id, tenant_id) references public.enrollments (id, tenant_id) on delete cascade
);
create index touches_due_idx on public.touches (tenant_id, status, due_at);
create index touches_company_idx on public.touches (tenant_id, company_id, created_at desc);
create index touches_recipient_idx on public.touches (tenant_id, recipient, sent_at desc);
create trigger touches_touch before update on public.touches
  for each row execute function app.touch_updated_at();

-- K-10.13: nothing addressed to a suppressed recipient or company can be approved, scheduled or sent.
create function app.enforce_suppression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_domain text;
begin
  if new.status not in ('approved', 'scheduled', 'ready', 'sent') then
    return new;
  end if;
  v_kind := case new.channel
    when 'email' then 'email'
    when 'whatsapp' then 'phone'
    when 'phone_call' then 'phone'
    when 'instagram_dm' then 'instagram'
    when 'linkedin' then 'linkedin'
    when 'x' then 'x'
    else null
  end;
  if v_kind is not null and new.recipient is not null and app.is_suppressed(new.tenant_id, v_kind, new.recipient) then
    raise exception 'recipient is on the suppression list' using errcode = 'P0001', hint = 'suppressed';
  end if;
  if new.channel = 'email' and new.recipient like '%@%' then
    v_domain := split_part(new.recipient, '@', 2);
    if app.is_suppressed(new.tenant_id, 'domain', v_domain) then
      raise exception 'recipient domain is on the suppression list' using errcode = 'P0001', hint = 'suppressed';
    end if;
  end if;
  if app.is_suppressed(new.tenant_id, 'company', new.company_id::text) then
    raise exception 'company is on the suppression list' using errcode = 'P0001', hint = 'suppressed';
  end if;
  return new;
end;
$$;
create trigger touches_suppression before insert or update on public.touches
  for each row execute function app.enforce_suppression();

create table public.inbox_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_id uuid,
  touch_id uuid references public.touches (id) on delete set null,
  channel public.channel not null default 'email',
  provider_message_id text,
  thread_id text,
  from_address text,
  subject text,
  body text,
  received_at timestamptz not null default now(),
  classification text check (classification in ('interested', 'question', 'later', 'no', 'do_not_contact', 'auto_reply', 'unknown')),
  classified_by text check (classified_by in ('rule', 'model', 'manual')),
  handled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider_message_id),
  foreign key (company_id, tenant_id) references public.companies (id, tenant_id) on delete set null
);
create index inbox_messages_recent_idx on public.inbox_messages (tenant_id, received_at desc);

do $$
declare
  t text;
begin
  foreach t in array array['enrollments', 'touches', 'inbox_messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (app.can_access_tenant(tenant_id)) with check (app.can_access_tenant(tenant_id))',
      t || '_tenant_rw', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function app.audit_row_change()',
      t || '_audit', t);
  end loop;
end;
$$;
revoke all on public.enrollments, public.touches, public.inbox_messages from anon;

-- Touches sent to a recipient within a rolling week (K-10.11).
create function app.touches_last_week(p_tenant_id uuid, p_recipient text)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::int from public.touches
  where tenant_id = p_tenant_id and recipient = p_recipient and status = 'sent'
    and sent_at > now() - interval '7 days';
$$;
grant execute on function app.touches_last_week(uuid, text) to authenticated, service_role;
