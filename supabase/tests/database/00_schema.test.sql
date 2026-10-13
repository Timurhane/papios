-- Structural guarantees: RLS on every table, tenant_id everywhere, anon has no table access.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select is_empty(
  $$ select tablename from pg_tables where schemaname = 'public' and not rowsecurity $$,
  'RLS is enabled on every public table'
);

select is_empty(
  $$ select t.tablename from pg_tables t
     where t.schemaname = 'public' and t.tablename <> 'tenants'
       and not exists (
         select 1 from information_schema.columns c
         where c.table_schema = 'public' and c.table_name = t.tablename and c.column_name = 'tenant_id'
       ) $$,
  'every public table except tenants has tenant_id'
);

select is_empty(
  $$ select table_name, privilege_type from information_schema.role_table_grants
     where grantee = 'anon' and table_schema = 'public' $$,
  'anon has no privileges on public tables'
);

select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and not exists (select 1 from pg_policy p where p.polrelid = c.oid) $$,
  'every public table has at least one policy'
);

select * from finish();
rollback;
