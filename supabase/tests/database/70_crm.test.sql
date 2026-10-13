-- Phase 2 CRM: next step required, duplicate guards, tenant isolation, CSV import RPC.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select throws_ok(
  $$ insert into public.companies (tenant_id, name, name_norm, source, next_step_kind)
     values ('00000000-0000-4000-8000-00000000a1a0', 'X', 'x', 'manual', 'waiting') $$,
  '23514', null, 'a waiting company needs a reason and a date (K-2.5)');
select throws_ok(
  $$ insert into public.companies (tenant_id, name, name_norm, source, next_step_kind)
     values ('00000000-0000-4000-8000-00000000a1a0', 'X', 'x', 'manual', 'playbook') $$,
  '23514', null, 'a playbook company needs a playbook');
select lives_ok(
  $$ insert into public.companies (tenant_id, name, name_norm, source, domain, phone_e164, waiting_reason, waiting_until)
     values ('00000000-0000-4000-8000-00000000a1a0', 'Örnek Klinik', 'ornek klinik', 'manual',
             'ornekklinik.com', '905321234567', 'analiz bekliyor', current_date) $$,
  'valid company is accepted');
select throws_ok(
  $$ insert into public.companies (tenant_id, name, name_norm, source, domain, waiting_reason, waiting_until)
     values ('00000000-0000-4000-8000-00000000a1a0', 'Başka', 'baska', 'manual', 'ornekklinik.com', 'x', current_date) $$,
  '23505', null, 'same domain twice is rejected (K-8.10)');
select throws_ok(
  $$ insert into public.companies (tenant_id, name, name_norm, source, phone_e164, waiting_reason, waiting_until)
     values ('00000000-0000-4000-8000-00000000a1a0', 'Başka', 'baska', 'manual', '905321234567', 'x', current_date) $$,
  '23505', null, 'same phone twice is rejected');

-- Another tenant cannot attach a contact to AJNA's company.
insert into public.tenants (id, slug, name) values ('00000000-0000-4000-8000-0000000000b2', 'tenant-b', 'B');
select throws_ok(
  $$ insert into public.contacts (tenant_id, company_id, source)
     select '00000000-0000-4000-8000-0000000000b2', id, 'manual' from public.companies where domain = 'ornekklinik.com' $$,
  '23503', null, 'cross-tenant contact is impossible');

insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000bbbb', 'b@example.test');
select app.attach_owner('tenant-b', 'b@example.test');
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"00000000-0000-4000-8000-00000000bbbb","role":"authenticated","aal":"aal2"}';
select is((select count(*)::int from public.companies), 0, 'tenant B sees no AJNA companies');
select throws_ok(
  $$ select app.enqueue_csv_import('00000000-0000-4000-8000-00000000a1a0', '[]'::jsonb) $$,
  '42501', null, 'cannot queue an import into another tenant');
select isnt(app.enqueue_csv_import('00000000-0000-4000-8000-0000000000b2', '[{"name":"a"}]'::jsonb), null,
  'own tenant import is queued');

select * from finish();
rollback;
