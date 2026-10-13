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
