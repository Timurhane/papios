-- Phase 5: projects, setup forms (K-14.4), Operatör artifacts, finance (K-13.8), notes, module metrics.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_id uuid not null,
  proposal_id uuid,
  name text not null,
  package_code text not null,
  payment_path text not null check (payment_path in ('no_setup', 'setup', 'project')),
  monthly_kurus bigint check (monthly_kurus >= 0),
  setup_fee_kurus bigint check (setup_fee_kurus >= 0),
  project_kurus bigint check (project_kurus >= 0),
  status text not null default 'setup' check (status in ('setup', 'active', 'paused', 'ended')),
  started_on date not null,
  contract_end date,
  satisfaction text check (satisfaction in ('positive', 'negative')),
  -- per-client capability for the delivered modules to post monthly aggregate metrics (no personal data)
  metrics_token text not null unique check (length(metrics_token) >= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (company_id, tenant_id) references public.companies (id, tenant_id) on delete cascade,
  foreign key (proposal_id) references public.proposals (id) on delete set null
);
create unique index projects_proposal_uniq on public.projects (proposal_id) where proposal_id is not null;
create index projects_company_idx on public.projects (tenant_id, company_id);
create trigger projects_touch before update on public.projects
  for each row execute function app.touch_updated_at();

create table public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null,
  position smallint not null,
  title text not null,
  module_code text,
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (project_id, tenant_id) references public.projects (id, tenant_id) on delete cascade
);
create index project_tasks_project_idx on public.project_tasks (tenant_id, project_id, position);

-- K-14.4: the client fills the setup form through an unguessable link.
create table public.setup_forms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null unique,
  token text not null unique check (length(token) >= 40),
  package_code text not null,
  -- client data (client_sensitive): never sent to a model
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  status text not null default 'sent' check (status in ('sent', 'submitted', 'reviewed')),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, tenant_id) references public.projects (id, tenant_id) on delete cascade
);
create trigger setup_forms_touch before update on public.setup_forms
  for each row execute function app.touch_updated_at();

-- Operatör outputs (K-14.2): client config, Claude Code setup prompt, checklist; generated from templates.
create table public.project_artifacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null,
  kind text not null check (kind in ('config', 'claude_prompt', 'checklist')),
  content text not null,
  created_at timestamptz not null default now(),
  unique (project_id, kind),
  foreign key (project_id, tenant_id) references public.projects (id, tenant_id) on delete cascade
);

-- K-13.8 finance. Amounts in kuruş.
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_id uuid not null,
  project_id uuid,
  monthly_kurus bigint not null check (monthly_kurus >= 0),
  discounted_monthly_kurus bigint check (discounted_monthly_kurus >= 0),
  discount_months smallint not null default 0 check (discount_months >= 0),
  started_on date not null,
  commitment_months smallint not null check (commitment_months > 0),
  day_of_month smallint not null check (day_of_month between 1 and 28),
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  cancelled_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (company_id, tenant_id) references public.companies (id, tenant_id) on delete cascade,
  foreign key (project_id, tenant_id) references public.projects (id, tenant_id) on delete set null (project_id)
);
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function app.touch_updated_at();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_id uuid not null,
  subscription_id uuid,
  project_id uuid,
  kind text not null check (kind in ('setup', 'monthly', 'project', 'other')),
  amount_kurus bigint not null check (amount_kurus > 0),
  due_on date not null,
  status text not null default 'due' check (status in ('due', 'paid', 'cancelled')),
  paid_on date,
  -- K-13.8: payment link is created by hand (iyzico/PayTR adapter off)
  payment_link text,
  note text,
  overdue_notified_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_paid_has_date check (status <> 'paid' or paid_on is not null),
  foreign key (company_id, tenant_id) references public.companies (id, tenant_id) on delete cascade,
  foreign key (subscription_id, tenant_id) references public.subscriptions (id, tenant_id) on delete set null (subscription_id),
  foreign key (project_id, tenant_id) references public.projects (id, tenant_id) on delete set null (project_id)
);
create unique index payments_period_uniq on public.payments (subscription_id, due_on) where subscription_id is not null;
create index payments_due_idx on public.payments (tenant_id, status, due_on);
create trigger payments_touch before update on public.payments
  for each row execute function app.touch_updated_at();

create table public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null check (kind in ('income', 'expense')),
  category text not null,
  amount_kurus bigint not null check (amount_kurus > 0),
  occurred_on date not null,
  company_id uuid,
  payment_id uuid unique references public.payments (id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  foreign key (company_id, tenant_id) references public.companies (id, tenant_id) on delete set null (company_id)
);
create index finance_entries_date_idx on public.finance_entries (tenant_id, occurred_on desc);

-- A paid payment is booked as income exactly once.
create function app.book_paid_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    insert into public.finance_entries (tenant_id, kind, category, amount_kurus, occurred_on, company_id, payment_id, note)
    values (new.tenant_id, 'income', new.kind, new.amount_kurus, new.paid_on, new.company_id, new.id, new.note)
    on conflict (payment_id) do nothing;
  elsif tg_op = 'UPDATE' and old.status = 'paid' and new.status <> 'paid' then
    delete from public.finance_entries where payment_id = new.id;
  end if;
  return new;
end;
$$;
create trigger payments_book after insert or update on public.payments
  for each row execute function app.book_paid_payment();

-- Notes (K-13.2): text and voice notes; embeddings only of the redacted text (K-4.9).
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_id uuid,
  project_id uuid,
  body text not null check (length(body) between 1 and 20000),
  tags text[] not null default '{}',
  source text not null check (source in ('telegram_text', 'telegram_voice', 'panel')),
  embedding extensions.vector(768),
  created_at timestamptz not null default now(),
  foreign key (company_id, tenant_id) references public.companies (id, tenant_id) on delete set null (company_id),
  foreign key (project_id, tenant_id) references public.projects (id, tenant_id) on delete set null (project_id)
);
create index notes_recent_idx on public.notes (tenant_id, created_at desc);
create index notes_tags_idx on public.notes using gin (tags);

-- Monthly aggregate counts posted by the delivered modules (no personal data).
create table public.module_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null,
  period date not null check (extract(day from period) = 1),
  metrics jsonb not null check (jsonb_typeof(metrics) = 'object'),
  received_at timestamptz not null default now(),
  unique (project_id, period),
  foreign key (project_id, tenant_id) references public.projects (id, tenant_id) on delete cascade
);

do $$
declare
  t text;
begin
  foreach t in array array[
    'projects', 'project_tasks', 'setup_forms', 'project_artifacts', 'subscriptions', 'payments',
    'finance_entries', 'notes', 'module_metrics'
  ] loop
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

-- Public setup form (service role only): load by token, or submit answers once while open.
create function app.setup_form_by_token(p_token text)
returns table (result text, form_id uuid, project_id uuid, package_code text, answers jsonb, expires_at timestamptz, business_name text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v public.setup_forms;
  v_name text;
begin
  select * into v from public.setup_forms f where f.token = p_token;
  if v.id is null then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::jsonb, null::timestamptz, null::text;
    return;
  end if;
  select c.name into v_name from public.projects p join public.companies c on c.id = p.company_id where p.id = v.project_id;
  return query select
    case when v.expires_at <= now() then 'expired' when v.status <> 'sent' then 'submitted' else 'ok' end,
    v.id, v.project_id, v.package_code, v.answers, v.expires_at, v_name;
end;
$$;
revoke all on function app.setup_form_by_token(text) from public;
grant execute on function app.setup_form_by_token(text) to service_role;

create function app.submit_setup_form(p_token text, p_answers jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.setup_forms;
begin
  if jsonb_typeof(p_answers) <> 'object' or length(p_answers::text) > 50000 then
    raise exception 'invalid answers';
  end if;
  select * into v from public.setup_forms where token = p_token for update;
  if v.id is null or v.status <> 'sent' or v.expires_at <= now() then
    return false;
  end if;
  update public.setup_forms set answers = p_answers, status = 'submitted', submitted_at = now() where id = v.id;
  return true;
end;
$$;
revoke all on function app.submit_setup_form(text, jsonb) from public;
grant execute on function app.submit_setup_form(text, jsonb) to service_role;
