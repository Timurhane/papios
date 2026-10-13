-- Phase 2: CRM (companies, contacts), analyses, score history, signals, timeline.

create type public.company_stage as enum (
  'new', 'analyzing', 'analyzed', 'waitlist', 'in_playbook', 'replied', 'meeting', 'proposal', 'won', 'lost', 'closed'
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  name_norm text not null,
  domain text check (domain is null or domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^[0-9]{10,15}$'),
  website_url text,
  instagram_handle text,
  linkedin_url text,
  maps_url text,
  emails text[] not null default '{}',
  city text,
  district text,
  address text,
  lat double precision,
  lng double precision,
  sector text,
  sector_source text check (sector_source in ('rule', 'model', 'manual', 'source')),
  source text not null check (source in ('telegram', 'csv', 'osm', 'grounding', 'instagram', 'analysis_tool', 'manual', 'places')),
  source_ref text,
  verified boolean not null default false,
  stage public.company_stage not null default 'new',
  score smallint check (score between 0 and 100),
  score_fit smallint,
  score_pain smallint,
  score_reach smallint,
  score_rationale jsonb not null default '[]'::jsonb,
  -- K-2.5: every record has a next step: a playbook, a waiting reason with a date, or closed.
  next_step_kind text not null default 'waiting' check (next_step_kind in ('playbook', 'waiting', 'closed')),
  assigned_playbook text,
  waiting_reason text,
  waiting_until date,
  last_analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_next_step check (
    (next_step_kind = 'playbook' and assigned_playbook is not null)
    or (next_step_kind = 'waiting' and waiting_reason is not null and waiting_until is not null)
    or next_step_kind = 'closed'
  ),
  unique (id, tenant_id)
);
-- K-8.10 duplicate guards.
create unique index companies_domain_uniq on public.companies (tenant_id, domain) where domain is not null;
create unique index companies_phone_uniq on public.companies (tenant_id, phone_e164) where phone_e164 is not null;
create unique index companies_instagram_uniq on public.companies (tenant_id, instagram_handle) where instagram_handle is not null;
create index companies_name_city_idx on public.companies (tenant_id, name_norm, city);
create index companies_stage_idx on public.companies (tenant_id, stage, score desc);
create trigger companies_touch before update on public.companies
  for each row execute function app.touch_updated_at();

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_id uuid not null,
  full_name text,
  role text,
  email text,
  phone_e164 text,
  instagram_handle text,
  linkedin_url text,
  is_decision_maker boolean not null default false,
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, tenant_id) references public.companies (id, tenant_id) on delete cascade
);
create index contacts_company_idx on public.contacts (tenant_id, company_id);
create trigger contacts_touch before update on public.contacts
  for each row execute function app.touch_updated_at();

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_id uuid not null,
  kind text not null check (kind in ('light', 'deep')),
  status text not null check (status in ('ok', 'partial', 'failed')),
  signals jsonb not null default '{}'::jsonb,
  pagespeed jsonb,
  findings jsonb not null default '[]'::jsonb,
  strongest_finding text,
  error text,
  created_at timestamptz not null default now(),
  foreign key (company_id, tenant_id) references public.companies (id, tenant_id) on delete cascade
);
create index analyses_company_idx on public.analyses (tenant_id, company_id, created_at desc);

create table public.score_history (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_id uuid not null,
  total smallint not null check (total between 0 and 100),
  fit smallint not null,
  pain smallint not null,
  reach smallint not null,
  rationale jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (company_id, tenant_id) references public.companies (id, tenant_id) on delete cascade
);
create index score_history_company_idx on public.score_history (tenant_id, company_id, created_at desc);

create table public.signals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_id uuid,
  kind text not null check (kind in ('new_opening', 'job_posting', 'bad_reviews', 'growth', 'other')),
  description text not null,
  source_url text,
  detected_at timestamptz not null default now(),
  foreign key (company_id, tenant_id) references public.companies (id, tenant_id) on delete cascade
);

create table public.company_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_id uuid not null,
  occurred_at timestamptz not null default now(),
  kind text not null,
  summary text not null,
  data jsonb not null default '{}'::jsonb,
  foreign key (company_id, tenant_id) references public.companies (id, tenant_id) on delete cascade
);
create index company_events_company_idx on public.company_events (tenant_id, company_id, occurred_at desc);

-- RLS: members (aal2) manage CRM data; history tables are read-only for users.
do $$
declare
  t text;
begin
  foreach t in array array['companies', 'contacts', 'signals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (app.can_access_tenant(tenant_id)) with check (app.can_access_tenant(tenant_id))',
      t || '_tenant_rw', t);
  end loop;
  foreach t in array array['analyses', 'score_history', 'company_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (app.can_access_tenant(tenant_id))',
      t || '_select', t);
  end loop;
end;
$$;
revoke insert, update, delete on public.analyses, public.score_history, public.company_events from authenticated;
revoke all on public.companies, public.contacts, public.analyses, public.score_history, public.signals,
  public.company_events from anon;

create trigger companies_audit after insert or update or delete on public.companies
  for each row execute function app.audit_row_change();
create trigger contacts_audit after insert or update or delete on public.contacts
  for each row execute function app.audit_row_change();

-- Panel CSV import: queues rows for the Actions worker, which normalizes and de-duplicates them (single path).
create function app.enqueue_csv_import(p_tenant_id uuid, p_rows jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.can_access_tenant(p_tenant_id) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'rows must be an array of at most 2000 items';
  end if;
  -- heavy: bulk rows run in the Actions worker (Workers free plan: 50 subrequests per invocation)
  insert into public.jobs (tenant_id, type, payload, heavy)
  values (p_tenant_id, 'kasif.csv_import', jsonb_build_object('rows', p_rows), true)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function app.enqueue_csv_import(uuid, jsonb) from public;
grant execute on function app.enqueue_csv_import(uuid, jsonb) to authenticated;
