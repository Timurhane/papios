-- Extensions and shared helpers.
-- Decisions: K-1.3 (multi-tenant via tenant_id + RLS), K-17.1 (TOTP required), K-17.2 (RLS everywhere).

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create schema if not exists app;
comment on schema app is 'Papi internal helpers. Not exposed through the Data API.';

grant usage on schema app to authenticated, service_role;

-- Tenants are the root of isolation.
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenant_members (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member', 'client')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_members_user_id_idx on public.tenant_members (user_id);

-- Tenant ids the current user belongs to. SECURITY DEFINER so policies on tenant_members
-- itself do not recurse.
create function app.user_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tm.tenant_id
  from public.tenant_members tm
  where tm.user_id = auth.uid()
    and tm.role in ('owner', 'member');
$$;

-- True only when the session passed TOTP (authenticator assurance level 2).
create function app.is_aal2()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

-- Standard predicate for tenant-scoped rows.
create function app.can_access_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.is_aal2() and p_tenant_id in (select app.user_tenant_ids());
$$;

revoke all on function app.user_tenant_ids() from public;
revoke all on function app.is_aal2() from public;
revoke all on function app.can_access_tenant(uuid) from public;
grant execute on function app.user_tenant_ids() to authenticated, service_role;
grant execute on function app.is_aal2() to authenticated, service_role;
grant execute on function app.can_access_tenant(uuid) to authenticated, service_role;

create function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tenants_touch before update on public.tenants
  for each row execute function app.touch_updated_at();

alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;

create policy tenants_select on public.tenants
  for select to authenticated
  using (app.can_access_tenant(id));

create policy tenant_members_select on public.tenant_members
  for select to authenticated
  using (app.can_access_tenant(tenant_id));
-- No insert/update/delete policies: membership is managed with the service role only.
