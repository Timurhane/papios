-- Phase 0 acceptance: a user can never read or write another tenant's data, and a session
-- without TOTP (aal1) sees nothing at all.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- Fixtures (rolled back at the end).
insert into public.tenants (id, slug, name)
values ('00000000-0000-4000-8000-0000000000b2', 'tenant-b', 'Tenant B');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000aaaa', 'owner-a@example.test'),
  ('00000000-0000-4000-8000-00000000bbbb', 'owner-b@example.test');
select app.attach_owner('ajna', 'owner-a@example.test');
select app.attach_owner('tenant-b', 'owner-b@example.test');
insert into public.settings (tenant_id, key, value)
values ('00000000-0000-4000-8000-0000000000b2', 'secret_b', '"tenant b only"');
insert into public.knowledge_items (tenant_id, kind, title, content)
values ('00000000-0000-4000-8000-0000000000b2', 'brand', 'B marka', 'B gizli');

-- User A, fully authenticated (aal2).
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"00000000-0000-4000-8000-00000000aaaa","role":"authenticated","aal":"aal2"}';

select ok((select count(*) from public.settings) > 0, 'A sees own settings');
select is(
  (select count(*)::int from public.settings where tenant_id = '00000000-0000-4000-8000-0000000000b2'),
  0, 'A cannot read B settings');
select is(
  (select count(*)::int from public.knowledge_items where tenant_id = '00000000-0000-4000-8000-0000000000b2'),
  0, 'A cannot read B knowledge');
select is((select count(*)::int from public.tenants), 1, 'A sees only own tenant');
select is((select count(*)::int from public.tenant_members), 1, 'A sees only own membership');

update public.settings set value = '"hacked"' where key = 'secret_b';
select throws_ok(
  $$ insert into public.settings (tenant_id, key, value)
     values ('00000000-0000-4000-8000-0000000000b2', 'injected', '1') $$,
  '42501', null, 'A cannot insert into B');
select throws_ok(
  $$ update public.settings set tenant_id = '00000000-0000-4000-8000-0000000000b2'
     where key = 'vat' $$,
  '42501', null, 'A cannot move own row into B');
select throws_ok(
  $$ insert into public.tenant_members (tenant_id, user_id)
     values ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-00000000aaaa') $$,
  '42501', null, 'A cannot add itself to B');
select throws_ok(
  $$ insert into public.audit_log (tenant_id, actor_type, action)
     values ('00000000-0000-4000-8000-00000000a1a0', 'user', 'forged') $$,
  '42501', null, 'A cannot write audit entries directly');
select throws_ok(
  $$ select * from app.claim_jobs('x', false, 1) $$,
  '42501', null, 'A cannot claim jobs');

-- Same user without TOTP (aal1).
set local request.jwt.claims to
  '{"sub":"00000000-0000-4000-8000-00000000aaaa","role":"authenticated","aal":"aal1"}';
select is((select count(*)::int from public.settings), 0, 'aal1 session sees no settings');
select is((select count(*)::int from public.tenants), 0, 'aal1 session sees no tenants');
select is((select count(*)::int from public.playbooks), 0, 'aal1 session sees no playbooks');
select throws_ok(
  $$ insert into public.banned_phrases (tenant_id, phrase)
     values ('00000000-0000-4000-8000-00000000a1a0', 'x') $$,
  '42501', null, 'aal1 session cannot write');

-- Authenticated but not a member of any tenant.
set local request.jwt.claims to
  '{"sub":"00000000-0000-4000-8000-00000000cccc","role":"authenticated","aal":"aal2"}';
select is((select count(*)::int from public.settings), 0, 'non-member sees nothing');

-- Anonymous.
reset role;
set local role anon;
select throws_ok($$ select * from public.settings $$, '42501', null, 'anon cannot read settings');
select throws_ok($$ select * from public.tenants $$, '42501', null, 'anon cannot read tenants');

-- Back as superuser: B's row is untouched.
reset role;
select is(
  (select value #>> '{}' from public.settings
   where tenant_id = '00000000-0000-4000-8000-0000000000b2' and key = 'secret_b'),
  'tenant b only', 'B data unchanged after A''s update attempt');

select * from finish();
rollback;
