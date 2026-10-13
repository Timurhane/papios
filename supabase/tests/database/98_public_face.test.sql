-- Phase 7: analysis tool requests are internal (RLS); public pages reach them only through the Worker.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into public.tool_requests (tenant_id, email, query, consent_at, consent_version, token_hash, expires_at)
values ('00000000-0000-4000-8000-00000000a1a0', 'a@b.com', 'ornek.com', now(), '2026-10', 'h1', now() + interval '30 days');
select throws_ok(
  $$ insert into public.tool_requests (tenant_id, email, query, consent_at, consent_version, token_hash, expires_at)
     values ('00000000-0000-4000-8000-00000000a1a0', 'c@d.com', 'x.com', now(), '2026-10', 'h1', now()) $$,
  '23505', null, 'report token hashes are unique');

set local role anon;
select throws_ok($$ select * from public.tool_requests $$, '42501', null, 'anon cannot read tool requests');
reset role;
set local role authenticated;
select is((select count(*)::int from public.tool_requests), 0, 'a session without tenant access sees nothing');
reset role;

-- Client portal (K-13.11)
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000c11e1', 'musteri@ornek.com');
insert into public.companies (id, tenant_id, name, name_norm, source, stage, waiting_reason, waiting_until)
values ('00000000-0000-4000-8000-0000000c0a01', '00000000-0000-4000-8000-00000000a1a0', 'Portal Klinik', 'portal klinik', 'manual', 'won', 'x', current_date);
insert into public.projects (id, tenant_id, company_id, name, package_code, payment_path, started_on, contract_end, metrics_token)
values ('00000000-0000-4000-8000-0000000b0a01', '00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0a01',
        'Portal Klinik — Sistem', 'sistem', 'setup', current_date, current_date + 90, repeat('m', 40));
insert into public.project_tasks (tenant_id, project_id, position, title)
values ('00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000b0a01', 1, 'Site kutusu kuruldu');
insert into public.client_users (tenant_id, user_id, project_id)
values ('00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c11e1', '00000000-0000-4000-8000-0000000b0a01');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c11e1","role":"authenticated","aal":"aal1"}';
select throws_ok($$ select app.portal_project() $$, '42501', null, 'portal is closed while the flag is off');
select is((select count(*)::int from public.projects), 0, 'a portal user reads no table directly');
reset role;

update public.feature_flags set enabled = true
  where tenant_id = '00000000-0000-4000-8000-00000000a1a0' and key = 'client_portal';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c11e1","role":"authenticated","aal":"aal1"}';
select is(app.portal_project() ->> 'name', 'Portal Klinik — Sistem', 'with the flag on, the client sees their project');
select is(app.portal_project() -> 'tasks' -> 0 ->> 'title', 'Site kutusu kuruldu', 'and its checklist');
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000dead","role":"authenticated","aal":"aal1"}';
select is(app.portal_project(), null, 'an unlinked user gets nothing');
reset role;

-- K-17.7 retention and one-click deletion
insert into public.companies (id, tenant_id, name, name_norm, source, stage, emails, phone_e164, waiting_reason, waiting_until, created_at)
values ('00000000-0000-4000-8000-0000000c0e01', '00000000-0000-4000-8000-00000000a1a0', 'Eski Aday', 'eski aday', 'manual', 'waitlist',
        '{eski@aday.com}', '905321112233', 'x', current_date, now() - interval '13 months'),
       ('00000000-0000-4000-8000-0000000c0e02', '00000000-0000-4000-8000-00000000a1a0', 'Yeni Aday', 'yeni aday', 'manual', 'waitlist',
        '{yeni@aday.com}', null, 'x', current_date, now() - interval '1 month');
insert into public.contacts (tenant_id, company_id, full_name, email, source)
values ('00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0e01', 'Ali Veli', 'ali@aday.com', 'manual');

select is(app.run_retention('00000000-0000-4000-8000-00000000a1a0', 12), 1, 'only the stale unwon company is cleared');
select is((select count(*)::int from public.contacts where company_id = '00000000-0000-4000-8000-0000000c0e01'), 0,
  'its contacts are deleted');
select ok((select emails = '{}' and phone_e164 is null and name = 'Eski Aday' from public.companies
  where id = '00000000-0000-4000-8000-0000000c0e01'), 'personal fields are cleared, the firm stays');
select ok((select cardinality(emails) = 1 from public.companies where id = '00000000-0000-4000-8000-0000000c0e02'),
  'a recent lead keeps its data');

select app.clear_personal_data('00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0e02', true, 'test');
select ok(app.is_suppressed('00000000-0000-4000-8000-00000000a1a0', 'email', 'yeni@aday.com'),
  'one-click deletion puts the address on the global suppression list');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c11e1","role":"authenticated","aal":"aal1"}';
select throws_ok($$ select app.delete_company_personal_data('00000000-0000-4000-8000-0000000c0e01') $$, '42501', null,
  'a non-member cannot delete data');
reset role;

-- Free-tier usage overview
set local request.jwt.claims to '{"role":"service_role"}';
select ok((app.usage_overview('00000000-0000-4000-8000-00000000a1a0') ->> 'db_bytes')::bigint > 0,
  'usage overview reports the database size');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000c11e1","role":"authenticated","aal":"aal1"}';
select throws_ok($$ select app.usage_overview('00000000-0000-4000-8000-00000000a1a0') $$, '42501', null,
  'usage overview is for tenant members only');
select throws_ok($$ select app.run_retention('00000000-0000-4000-8000-00000000a1a0', 12) $$, '42501', null,
  'retention runs only on the server');
reset role;

-- Hardening (Phase 7): every table in public has RLS on and anon has no table privileges.
select is((select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity), 0,
  'row level security is enabled on every public table');
select is((select count(*)::int from information_schema.role_table_grants
           where grantee = 'anon' and table_schema = 'public'
             and privilege_type in ('INSERT', 'UPDATE', 'DELETE')), 0,
  'anon cannot write any public table');

select * from finish();
rollback;
