-- Immutable audit log (K-2.6, K-17.6) and global suppression list (K-2.7, K-10.13).

create table public.audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  occurred_at timestamptz not null default now(),
  actor_type text not null check (actor_type in ('user', 'agent', 'system', 'public')),
  -- user uuid, agent name (papi, kasif, ...) or job id
  actor_id text,
  action text not null,
  entity_type text,
  entity_id text,
  approved_by uuid,
  llm_provider text,
  llm_model text,
  tokens_in integer check (tokens_in >= 0),
  tokens_out integer check (tokens_out >= 0),
  quota_units integer check (quota_units >= 0),
  -- Must never carry personal data beyond ids (see docs/decisions.md V-9).
  details jsonb not null default '{}'::jsonb
);
create index audit_log_tenant_time_idx on public.audit_log (tenant_id, occurred_at desc);
create index audit_log_entity_idx on public.audit_log (tenant_id, entity_type, entity_id);

create function app.forbid_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function app.forbid_audit_mutation();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.forbid_audit_mutation();

alter table public.audit_log enable row level security;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (app.can_access_tenant(tenant_id));
-- Inserts happen through app.audit_row_change() (definer) or the service role.

-- Generic row-change auditor. Agents identify themselves with
--   set local app.actor = 'agent:ulak';
create function app.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_actor text := nullif(current_setting('app.actor', true), '');
  v_actor_type text;
  v_actor_id text;
begin
  if v_actor is not null and v_actor like 'agent:%' then
    v_actor_type := 'agent';
    v_actor_id := substr(v_actor, 7);
  elsif auth.uid() is not null then
    v_actor_type := 'user';
    v_actor_id := auth.uid()::text;
  else
    v_actor_type := 'system';
    v_actor_id := v_actor;
  end if;

  insert into public.audit_log (tenant_id, actor_type, actor_id, action, entity_type, entity_id, details)
  values (
    (v_row ->> 'tenant_id')::uuid,
    v_actor_type,
    v_actor_id,
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'key'),
    jsonb_build_object('row', v_row)
  );
  return null;
end;
$$;
revoke all on function app.audit_row_change() from public;

-- Suppression list: hashed so the block survives a KVKK deletion of the person (V-10).
create function app.normalize_contact(p_kind text, p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := lower(btrim(coalesce(p_value, '')));
begin
  case p_kind
    when 'email' then
      return v;
    when 'phone' then
      v := regexp_replace(v, '\D', '', 'g');
      if length(v) = 11 and left(v, 1) = '0' then
        v := '90' || substr(v, 2);
      elsif length(v) = 10 and left(v, 1) = '5' then
        v := '90' || v;
      end if;
      return v;
    when 'domain' then
      v := regexp_replace(v, '^[a-z]+://', '');
      v := regexp_replace(v, '^www\.', '');
      v := regexp_replace(v, '[/?#:].*$', '');
      return v;
    when 'instagram', 'linkedin', 'x' then
      return regexp_replace(v, '^@', '');
    when 'company' then
      return v;
    else
      raise exception 'unknown contact kind: %', p_kind;
  end case;
end;
$$;

create function app.contact_hash(p_kind text, p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_kind || ':' || app.normalize_contact(p_kind, p_value), 'UTF8')), 'hex');
$$;

grant execute on function app.normalize_contact(text, text) to authenticated, service_role;
grant execute on function app.contact_hash(text, text) to authenticated, service_role;

create table public.suppression_list (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null check (kind in ('email', 'phone', 'domain', 'instagram', 'linkedin', 'x', 'company')),
  value_hash text not null check (value_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason in ('unsubscribe_link', 'asked_not_to_contact', 'manual', 'data_deletion')),
  source text,
  created_at timestamptz not null default now(),
  unique (tenant_id, kind, value_hash)
);

alter table public.suppression_list enable row level security;
create policy suppression_select on public.suppression_list
  for select to authenticated using (app.can_access_tenant(tenant_id));
create policy suppression_insert on public.suppression_list
  for insert to authenticated with check (app.can_access_tenant(tenant_id));
-- No update/delete for users: the list is permanent (K-2.7).

create function app.is_suppressed(p_tenant_id uuid, p_kind text, p_value text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.suppression_list s
    where s.tenant_id = p_tenant_id
      and s.kind = p_kind
      and s.value_hash = app.contact_hash(p_kind, p_value)
  );
$$;
grant execute on function app.is_suppressed(uuid, text, text) to authenticated, service_role;

create function app.suppress(p_tenant_id uuid, p_kind text, p_value text, p_reason text, p_source text default null)
returns void
language sql
set search_path = ''
as $$
  insert into public.suppression_list (tenant_id, kind, value_hash, reason, source)
  values (p_tenant_id, p_kind, app.contact_hash(p_kind, p_value), p_reason, p_source)
  on conflict (tenant_id, kind, value_hash) do nothing;
$$;
grant execute on function app.suppress(uuid, text, text, text, text) to authenticated, service_role;
