-- Settings (every tunable value), feature flags, and the table-based job queue (K-3.15).

create table public.settings (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  -- Shape is validated by packages/core settingsSchemas before writes.
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);
create trigger settings_touch before update on public.settings
  for each row execute function app.touch_updated_at();

alter table public.settings enable row level security;
create policy settings_select on public.settings
  for select to authenticated using (app.can_access_tenant(tenant_id));
create policy settings_insert on public.settings
  for insert to authenticated with check (app.can_access_tenant(tenant_id));
create policy settings_update on public.settings
  for update to authenticated
  using (app.can_access_tenant(tenant_id))
  with check (app.can_access_tenant(tenant_id));

create table public.feature_flags (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  enabled boolean not null default false,
  description text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);
create trigger feature_flags_touch before update on public.feature_flags
  for each row execute function app.touch_updated_at();

alter table public.feature_flags enable row level security;
create policy feature_flags_select on public.feature_flags
  for select to authenticated using (app.can_access_tenant(tenant_id));
create policy feature_flags_update on public.feature_flags
  for update to authenticated
  using (app.can_access_tenant(tenant_id))
  with check (app.can_access_tenant(tenant_id));

create type public.job_status as enum ('queued', 'running', 'done', 'failed', 'dead');

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.job_status not null default 'queued',
  -- heavy jobs run on GitHub Actions, light ones in the Worker cron
  heavy boolean not null default false,
  priority smallint not null default 0,
  run_after timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_ready_idx on public.jobs (heavy, priority desc, run_after)
  where status = 'queued';
create trigger jobs_touch before update on public.jobs
  for each row execute function app.touch_updated_at();

alter table public.jobs enable row level security;
create policy jobs_select on public.jobs
  for select to authenticated using (app.can_access_tenant(tenant_id));

-- Atomically claims ready jobs for a worker. Service role only.
create function app.claim_jobs(p_worker text, p_heavy boolean, p_limit integer default 10)
returns setof public.jobs
language sql
security definer
set search_path = ''
as $$
  update public.jobs j
  set status = 'running',
      locked_at = now(),
      locked_by = p_worker,
      attempts = j.attempts + 1
  where j.id in (
    select id from public.jobs
    where status = 'queued'
      and heavy = p_heavy
      and run_after <= now()
    order by priority desc, run_after
    limit greatest(p_limit, 0)
    for update skip locked
  )
  returning j.*;
$$;
revoke all on function app.claim_jobs(text, boolean, integer) from public;
grant execute on function app.claim_jobs(text, boolean, integer) to service_role;
