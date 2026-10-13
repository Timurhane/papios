-- Phase 7: analysis tool requests are internal (RLS); public pages reach them only through the Worker.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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

select * from finish();
rollback;
