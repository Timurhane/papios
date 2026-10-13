-- Phase 4: meetings, proposals (K-13.6), personal demos (K-13.7), proposal PDFs in Storage (K-13.12).

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_id uuid not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'scheduled', 'done', 'cancelled', 'no_show')),
  -- offered start times (timestamptz ISO strings) while status = proposed
  proposed_slots jsonb not null default '[]'::jsonb check (jsonb_typeof(proposed_slots) = 'array'),
  starts_at timestamptz,
  duration_minutes smallint not null default 30 check (duration_minutes > 0),
  calendar_event_id text,
  -- raw note as dictated (personal data: never sent to a model unredacted, K-4.9)
  notes_raw text,
  -- structured note produced from the redacted text: needs, budget signal, objections, next step
  notes jsonb,
  source text check (source in ('telegram_voice', 'telegram_text', 'panel')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (company_id, tenant_id) references public.companies (id, tenant_id) on delete cascade
);
create index meetings_company_idx on public.meetings (tenant_id, company_id, created_at desc);
create index meetings_upcoming_idx on public.meetings (tenant_id, starts_at) where status = 'scheduled';
create trigger meetings_touch before update on public.meetings
  for each row execute function app.touch_updated_at();

-- Per-tenant yearly proposal numbers: AJNA-2026-0001.
create table public.doc_counters (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null,
  year smallint not null,
  last integer not null default 0,
  primary key (tenant_id, kind, year)
);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_id uuid not null,
  meeting_id uuid,
  number text not null,
  status text not null default 'draft'
    check (status in ('draft', 'awaiting_approval', 'approved', 'sent', 'accepted', 'rejected', 'expired', 'cancelled')),
  package_code text not null,
  -- the monthly fee the quote is built on (packages with "starting from" prices may differ from list)
  monthly_kurus bigint check (monthly_kurus > 0),
  -- computed quote: both payment paths, or the custom project breakdown (packages/core sales/pricing)
  quote jsonb not null default '{}'::jsonb,
  -- K-7.5: granted only when a slot is really free; a slot is consumed on acceptance
  founder_discount jsonb,
  founder_slot_used boolean not null default false,
  -- K-7.2 / A-6: asked on every proposal; empty only while the draft waits for the answer
  vat_mode text check (vat_mode in ('included', 'excluded')),
  valid_until date not null,
  intro text,
  scope jsonb not null default '[]'::jsonb check (jsonb_typeof(scope) = 'array'),
  approval_id uuid references public.approvals (id),
  pdf_path text,
  sent_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, number),
  constraint proposals_vat_before_approval check (vat_mode is not null or status in ('draft', 'cancelled')),
  foreign key (company_id, tenant_id) references public.companies (id, tenant_id) on delete cascade,
  foreign key (meeting_id, tenant_id) references public.meetings (id, tenant_id) on delete set null (meeting_id)
);
create index proposals_company_idx on public.proposals (tenant_id, company_id, created_at desc);
create index proposals_open_idx on public.proposals (tenant_id, status) where status in ('sent', 'approved');
create trigger proposals_touch before update on public.proposals
  for each row execute function app.touch_updated_at();

create function app.assign_proposal_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year smallint := extract(year from (now() at time zone 'Europe/Istanbul'))::smallint;
  v_last integer;
begin
  if new.number is not null and new.number <> '' then
    return new;
  end if;
  insert into public.doc_counters (tenant_id, kind, year, last)
  values (new.tenant_id, 'proposal', v_year, 1)
  on conflict (tenant_id, kind, year) do update set last = public.doc_counters.last + 1
  returning last into v_last;
  new.number := 'AJNA-' || v_year || '-' || lpad(v_last::text, 4, '0');
  return new;
end;
$$;
alter table public.proposals alter column number set default '';
create trigger proposals_number before insert on public.proposals
  for each row execute function app.assign_proposal_number();

-- K-13.7: personal demo pages. The token is an unguessable capability (32 random bytes, base64url);
-- the public endpoint reads only this table, through app.demo_touch.
create table public.demos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_id uuid not null,
  token text not null unique check (length(token) >= 40),
  -- everything the demo assistant may know: public business info + AJNA package summary
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  status text not null default 'active' check (status in ('active', 'closed')),
  expires_at timestamptz not null,
  visits integer not null default 0,
  messages integer not null default 0,
  last_visit_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, tenant_id) references public.companies (id, tenant_id) on delete cascade
);
create index demos_company_idx on public.demos (tenant_id, company_id);
create trigger demos_touch before update on public.demos
  for each row execute function app.touch_updated_at();

create table public.demo_usage (
  demo_id uuid not null references public.demos (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  day date not null,
  messages integer not null default 0,
  primary key (demo_id, day)
);

do $$
declare
  t text;
begin
  foreach t in array array['meetings', 'proposals', 'demos'] loop
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
  foreach t in array array['doc_counters', 'demo_usage'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (app.can_access_tenant(tenant_id))',
      t || '_select', t);
  end loop;
end;
$$;
revoke all on public.meetings, public.proposals, public.demos, public.doc_counters, public.demo_usage from anon;
revoke insert, update, delete on public.doc_counters, public.demo_usage from authenticated;

-- Public demo endpoint (service role only): counts a visit or a message atomically and enforces the
-- per-demo and total daily message limits. Returns the snapshot only when the demo is usable.
create function app.demo_touch(p_token text, p_kind text, p_per_demo integer, p_total integer)
returns table (result text, demo_id uuid, company_id uuid, snapshot jsonb, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v public.demos;
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_used integer;
  v_total integer;
begin
  if p_kind not in ('visit', 'message') then
    raise exception 'invalid kind %', p_kind;
  end if;
  select * into v from public.demos d where d.token = p_token for update;
  if v.id is null then
    return query select 'not_found'::text, null::uuid, null::uuid, null::jsonb, null::timestamptz;
    return;
  end if;
  if v.status <> 'active' or v.expires_at <= now() then
    if v.status = 'active' then
      update public.demos set status = 'closed' where id = v.id;
    end if;
    return query select 'expired'::text, v.id, v.company_id, null::jsonb, v.expires_at;
    return;
  end if;
  if p_kind = 'visit' then
    update public.demos set visits = visits + 1, last_visit_at = now() where id = v.id;
    if v.visits = 0 then
      insert into public.company_events (tenant_id, company_id, kind, summary)
      values (v.tenant_id, v.company_id, 'demo_visit', 'Demo ilk kez açıldı');
    end if;
    return query select 'ok'::text, v.id, v.company_id, v.snapshot, v.expires_at;
    return;
  end if;
  select coalesce(sum(u.messages), 0)::int into v_total
  from public.demo_usage u where u.tenant_id = v.tenant_id and u.day = v_today;
  if v_total >= p_total then
    return query select 'total_limit'::text, v.id, v.company_id, null::jsonb, v.expires_at;
    return;
  end if;
  insert into public.demo_usage (demo_id, tenant_id, day, messages)
  values (v.id, v.tenant_id, v_today, 1)
  on conflict (demo_id, day) do update set messages = public.demo_usage.messages + 1
  returning messages into v_used;
  if v_used > p_per_demo then
    update public.demo_usage set messages = messages - 1 where demo_id = v.id and day = v_today;
    return query select 'demo_limit'::text, v.id, v.company_id, null::jsonb, v.expires_at;
    return;
  end if;
  update public.demos set messages = messages + 1 where id = v.id;
  if v.messages = 0 then
    insert into public.company_events (tenant_id, company_id, kind, summary)
    values (v.tenant_id, v.company_id, 'demo_message', 'Demo asistanına ilk mesaj yazıldı');
  end if;
  return query select 'ok'::text, v.id, v.company_id, v.snapshot, v.expires_at;
end;
$$;
revoke all on function app.demo_touch(text, text, integer, integer) from public;
grant execute on function app.demo_touch(text, text, integer, integer) to service_role;

-- Proposal accepted (panel or Telegram): consumes a founder slot when the proposal carries the
-- founder discount (K-7.5). Fails if no slot is left, so the counter can never be exceeded.
create function app.accept_proposal(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.proposals;
begin
  select * into v from public.proposals where id = p_id for update;
  if v.id is null or not (app.can_access_tenant(v.tenant_id) or auth.role() = 'service_role') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v.status not in ('sent', 'approved') then
    return false;
  end if;
  if v.founder_discount is not null and not v.founder_slot_used then
    update public.founder_discount set used_slots = used_slots + 1
    where tenant_id = v.tenant_id and used_slots < total_slots;
    if not found then
      raise exception 'Kurucu müşteri kontenjanı dolu' using errcode = 'P0001';
    end if;
  end if;
  update public.proposals
  set status = 'accepted', decided_at = now(),
      founder_slot_used = founder_slot_used or founder_discount is not null
  where id = p_id;
  insert into public.company_events (tenant_id, company_id, kind, summary)
  values (v.tenant_id, v.company_id, 'proposal_accepted', 'Teklif kabul edildi: ' || v.number);
  return true;
end;
$$;
revoke all on function app.accept_proposal(uuid) from public;
grant execute on function app.accept_proposal(uuid) to authenticated, service_role;

-- K-13.12: proposal PDFs, private bucket, one folder per tenant: {tenant_id}/{proposal_id}.pdf
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proposals', 'proposals', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;

-- CASE keeps the uuid cast away from other buckets' paths (AND does not guarantee evaluation order).
create function app.can_access_proposal_object(p_bucket text, p_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_bucket = 'proposals'
      and (storage.foldername(p_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then app.can_access_tenant(((storage.foldername(p_name))[1])::uuid)
    else false
  end;
$$;
grant execute on function app.can_access_proposal_object(text, text) to authenticated;

create policy proposals_pdf_rw on storage.objects for all to authenticated
  using (app.can_access_proposal_object(bucket_id, name))
  with check (app.can_access_proposal_object(bucket_id, name));

-- Fixed-window rate limits for public endpoints (K-17.4): demo pages now, the analysis tool later.
-- Keys are hashed by the caller (no raw IPs stored). Internal schema: not tenant data, no API role access.
create table app.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);
alter table app.rate_limits enable row level security;
revoke all on app.rate_limits from anon, authenticated, service_role;

create function app.hit_rate_limit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into app.rate_limits (key, window_start, hits) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = app.rate_limits.hits + 1
  returning hits into v_hits;
  -- opportunistic cleanup of old windows
  delete from app.rate_limits where window_start < now() - interval '1 day' and key = p_key;
  return v_hits <= p_max;
end;
$$;
revoke all on function app.hit_rate_limit(text, integer, integer) from public;
grant execute on function app.hit_rate_limit(text, integer, integer) to service_role;
