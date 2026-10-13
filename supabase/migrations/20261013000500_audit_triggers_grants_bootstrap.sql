-- Attach the row auditor, lock down anon, and add the owner bootstrap helper.

do $$
declare
  t text;
begin
  foreach t in array array[
    'settings', 'feature_flags', 'suppression_list', 'service_packages', 'founder_discount',
    'playbooks', 'playbook_steps', 'knowledge_items', 'tone_profiles', 'banned_phrases'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function app.audit_row_change()',
      t || '_audit', t);
  end loop;
end;
$$;

-- Defense in depth: anon never touches tables directly. Public endpoints (analysis tool, demo,
-- unsubscribe) go through the Worker with narrowly scoped server-side code (K-17.4).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- Users never write to these directly.
revoke insert, update, delete on public.audit_log from authenticated;
revoke insert, update, delete on public.jobs from authenticated;
revoke insert, update, delete on public.tenants from authenticated;
revoke insert, update, delete on public.tenant_members from authenticated;

-- Links an existing auth user (invited from the Supabase dashboard) to a tenant as owner.
-- Run once with the service role:  select app.attach_owner('ajna', '<email>');
create function app.attach_owner(p_tenant_slug text, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
begin
  select id into v_tenant from public.tenants where slug = p_tenant_slug;
  if v_tenant is null then
    raise exception 'tenant % not found', p_tenant_slug;
  end if;
  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then
    raise exception 'user not found; invite the user first';
  end if;
  insert into public.tenant_members (tenant_id, user_id, role)
  values (v_tenant, v_user, 'owner')
  on conflict (tenant_id, user_id) do update set role = 'owner';
  return v_user;
end;
$$;
revoke all on function app.attach_owner(text, text) from public;
grant execute on function app.attach_owner(text, text) to service_role;
