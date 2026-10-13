-- Phase 6: routines (K-13.5), signals from site changes/news/OSM (K-8.11), Kalem content (K-13.9),
-- learning suggestions (K-6.8, K-11.6), geocoding cache (K-3.18).

-- Routine actions are an allowlist (packages/core routines.ts); a routine can never run arbitrary code.
create table public.routines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  -- {"kind":"daily"|"weekdays"|"weekly"|"monthly","time":"HH:MM","days":[1..7],"day":1..28}
  schedule jsonb not null check (jsonb_typeof(schedule) = 'object'),
  action text not null check (action in (
    'morning_brief', 'whom_to_call', 'signal_scan', 'competitor_scan', 'sector_news', 'payment_check',
    'monthly_reports', 'weekly_summary', 'hot_leads_digest', 'pipeline_digest', 'reminder', 'content_plan',
    'learning_review'
  )),
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  enabled boolean not null default true,
  source text not null default 'preset' check (source in ('preset', 'telegram', 'panel')),
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create index routines_due_idx on public.routines (tenant_id, next_run_at) where enabled;
create trigger routines_touch before update on public.routines
  for each row execute function app.touch_updated_at();

-- K-8.11 signal kinds; a fingerprint keeps the same change from being recorded twice.
alter table public.signals drop constraint signals_kind_check;
alter table public.signals add constraint signals_kind_check check (kind in (
  'new_opening', 'job_posting', 'bad_reviews', 'growth', 'other', 'site_change', 'news', 'campaign', 'instagram_activity'
));
alter table public.signals add column fingerprint text;
alter table public.signals add column handled boolean not null default false;
create unique index signals_fingerprint_uniq on public.signals (tenant_id, company_id, fingerprint) where fingerprint is not null;

-- Last seen features of a company's site, for change detection.
create table public.site_snapshots (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_id uuid not null,
  features jsonb not null check (jsonb_typeof(features) = 'object'),
  fetched_at timestamptz not null default now(),
  primary key (tenant_id, company_id),
  foreign key (company_id, tenant_id) references public.companies (id, tenant_id) on delete cascade
);

-- K-13.9 Kalem.
create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  platform text not null check (platform in ('linkedin', 'x', 'instagram')),
  week_of date not null,
  topic text not null,
  body text not null,
  status text not null default 'awaiting_approval'
    check (status in ('awaiting_approval', 'approved', 'posted', 'rejected')),
  approval_id uuid references public.approvals (id),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index content_items_week_idx on public.content_items (tenant_id, week_of desc);
create trigger content_items_touch before update on public.content_items
  for each row execute function app.touch_updated_at();

-- K-6.8 learned rules and K-11.6 playbook changes are only ever suggested; applying needs approval.
create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null check (kind in ('learned_rule', 'playbook_change')),
  title text not null,
  detail jsonb not null default '{}'::jsonb,
  fingerprint text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  approval_id uuid references public.approvals (id),
  created_at timestamptz not null default now(),
  unique (tenant_id, fingerprint)
);

do $$
declare
  t text;
begin
  foreach t in array array['routines', 'site_snapshots', 'content_items', 'suggestions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (app.can_access_tenant(tenant_id)) with check (app.can_access_tenant(tenant_id))',
      t || '_tenant_rw', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function app.audit_row_change()',
      t || '_audit', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end;
$$;

-- K-3.18: Nominatim results are cached (usage policy); not tenant data, internal schema only.
create table app.geocode_cache (
  query text primary key,
  lat double precision,
  lng double precision,
  found boolean not null,
  created_at timestamptz not null default now()
);
alter table app.geocode_cache enable row level security;
revoke all on app.geocode_cache from anon, authenticated;
grant select, insert, update on app.geocode_cache to service_role;
