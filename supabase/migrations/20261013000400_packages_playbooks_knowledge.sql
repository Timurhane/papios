-- Service packages (K-7), founder discount counter (K-7.5), playbooks (K-11), knowledge base (K-6).

create table public.service_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  -- integer kuruş; null when priced per project
  monthly_price_kurus bigint check (monthly_price_kurus >= 0),
  price_is_starting_from boolean not null default false,
  -- false for the custom (project) package, which has no setup/no-setup paths
  has_payment_paths boolean not null default true,
  includes_package_code text,
  summary text not null,
  features jsonb not null default '[]'::jsonb check (jsonb_typeof(features) = 'array'),
  position smallint not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create trigger service_packages_touch before update on public.service_packages
  for each row execute function app.touch_updated_at();

create table public.founder_discount (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  total_slots smallint not null check (total_slots >= 0),
  used_slots smallint not null default 0,
  setup_discount_max_pct smallint not null check (setup_discount_max_pct between 0 and 100),
  monthly_discount_pct smallint not null check (monthly_discount_pct between 0 and 100),
  monthly_discount_months smallint not null check (monthly_discount_months >= 0),
  updated_at timestamptz not null default now(),
  check (used_slots between 0 and total_slots)
);
create trigger founder_discount_touch before update on public.founder_discount
  for each row execute function app.touch_updated_at();

create type public.channel as enum (
  'email', 'whatsapp', 'instagram_dm', 'linkedin', 'x', 'phone_call', 'visit', 'demo'
);

create table public.playbooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  description text not null,
  trigger text not null,
  duration_days integer check (duration_days >= 0),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (tenant_id, code),
  unique (id, tenant_id)
);
create trigger playbooks_touch before update on public.playbooks
  for each row execute function app.touch_updated_at();

create table public.playbook_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  playbook_id uuid not null,
  position smallint not null check (position > 0),
  -- day offset relative to the anchor
  day_offset integer not null,
  anchor text not null default 'start' check (anchor in ('start', 'contract_end')),
  repeat_every_days integer check (repeat_every_days > 0),
  channel public.channel not null,
  angle text not null,
  conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions) = 'object'),
  requires_approval boolean not null default true,
  approval_exempt_kind text check (approval_exempt_kind in ('analysis_tool_report')),
  updated_at timestamptz not null default now(),
  unique (playbook_id, position),
  -- a step always belongs to a playbook of the same tenant
  foreign key (playbook_id, tenant_id) references public.playbooks (id, tenant_id) on delete cascade,
  -- K-2.1: anything Papi sends needs approval. Only Timurhan's own tasks (call/visit) and the
  -- analysis tool report (K-2.2) may skip it.
  constraint playbook_steps_approval_rule check (
    requires_approval
    or channel in ('phone_call', 'visit')
    or approval_exempt_kind is not distinct from 'analysis_tool_report'
  ),
  constraint playbook_steps_exempt_needs_flag check (
    approval_exempt_kind is null or requires_approval = false
  )
);
create index playbook_steps_playbook_idx on public.playbook_steps (playbook_id, position);
create trigger playbook_steps_touch before update on public.playbook_steps
  for each row execute function app.touch_updated_at();

create type public.knowledge_kind as enum (
  'brand', 'service', 'icp', 'objection', 'case_study', 'module_catalog', 'other'
);

create table public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind public.knowledge_kind not null,
  title text not null,
  content text not null default '',
  -- Gemini embedding, 768 dims (V-8); filled in Phase 1
  embedding extensions.vector(768),
  is_template boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index knowledge_items_kind_idx on public.knowledge_items (tenant_id, kind);
create trigger knowledge_items_touch before update on public.knowledge_items
  for each row execute function app.touch_updated_at();

create table public.tone_profiles (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  description text not null default '',
  dos jsonb not null default '[]'::jsonb check (jsonb_typeof(dos) = 'array'),
  donts jsonb not null default '[]'::jsonb check (jsonb_typeof(donts) = 'array'),
  examples jsonb not null default '[]'::jsonb check (jsonb_typeof(examples) = 'array'),
  updated_at timestamptz not null default now()
);
create trigger tone_profiles_touch before update on public.tone_profiles
  for each row execute function app.touch_updated_at();

create table public.banned_phrases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  phrase text not null check (length(btrim(phrase)) > 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, phrase)
);

-- RLS: tenant members with aal2 have full read/write on these configuration tables.
do $$
declare
  t text;
begin
  foreach t in array array[
    'service_packages', 'founder_discount', 'playbooks', 'playbook_steps',
    'knowledge_items', 'tone_profiles', 'banned_phrases'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (app.can_access_tenant(tenant_id))
         with check (app.can_access_tenant(tenant_id))',
      t || '_tenant_rw', t);
  end loop;
end;
$$;
