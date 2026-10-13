-- Phase 5: payments are booked once as income, setup forms submit once while open, tenant isolation.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into public.tenants (id, slug, name)
values ('00000000-0000-4000-8000-0000000000b2', 'tenant-b', 'Tenant B');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000bbbb', 'owner-b@example.test');
select app.attach_owner('tenant-b', 'owner-b@example.test');

insert into public.companies (id, tenant_id, name, name_norm, source, waiting_reason, waiting_until)
values ('00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-00000000a1a0', 'Örnek', 'ornek', 'manual', 'x', current_date);
insert into public.projects (id, tenant_id, company_id, name, package_code, payment_path, monthly_kurus, started_on, metrics_token)
values ('00000000-0000-4000-8000-0000000b0001', '00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001',
        'Örnek — Sistem', 'sistem', 'setup', 2167500, current_date, repeat('m', 43));

select throws_ok(
  $$ insert into public.projects (tenant_id, company_id, name, package_code, payment_path, started_on, metrics_token)
     values ('00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001', 'x', 'sistem', 'setup', current_date, 'short') $$,
  '23514', null, 'metrics token must be unguessable');

-- payments → income, once
insert into public.payments (id, tenant_id, company_id, project_id, kind, amount_kurus, due_on)
values ('00000000-0000-4000-8000-0000000a0101', '00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001',
        '00000000-0000-4000-8000-0000000b0001', 'setup', 2550000, current_date);
select is((select count(*)::int from public.finance_entries), 0, 'a due payment is not income');
select throws_ok(
  $$ update public.payments set status = 'paid' where id = '00000000-0000-4000-8000-0000000a0101' $$,
  '23514', null, 'paid needs a payment date');
update public.payments set status = 'paid', paid_on = current_date where id = '00000000-0000-4000-8000-0000000a0101';
update public.payments set note = 'havale' where id = '00000000-0000-4000-8000-0000000a0101';
select is((select count(*)::int from public.finance_entries where payment_id = '00000000-0000-4000-8000-0000000a0101'), 1,
  'paid payment booked once');
select is((select amount_kurus from public.finance_entries where payment_id = '00000000-0000-4000-8000-0000000a0101'), 2550000::bigint,
  'with its amount');
update public.payments set status = 'cancelled' where id = '00000000-0000-4000-8000-0000000a0101';
select is((select count(*)::int from public.finance_entries), 0, 'un-paying removes the income');

-- setup form
insert into public.setup_forms (tenant_id, project_id, token, package_code, expires_at)
values ('00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000b0001', repeat('f', 43), 'sistem', now() + interval '30 days');
set local role service_role;
select is((select result from app.setup_form_by_token(repeat('f', 43))), 'ok', 'open form loads');
select is((select business_name from app.setup_form_by_token(repeat('f', 43))), 'Örnek', 'with the business name');
select ok(app.submit_setup_form(repeat('f', 43), '{"hours":"09-18"}'), 'client submits');
select ok(not app.submit_setup_form(repeat('f', 43), '{"hours":"hacked"}'), 'a submitted form cannot be overwritten');
reset role;

-- tenant B sees nothing
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"00000000-0000-4000-8000-00000000bbbb","role":"authenticated","aal":"aal2"}';
select is((select count(*)::int from public.setup_forms) + (select count(*)::int from public.projects)
  + (select count(*)::int from public.payments), 0, 'other tenant sees no projects, forms or payments');
reset role;

set local role anon;
select throws_ok($$ select * from app.setup_form_by_token(repeat('f', 43)) $$, '42501', null,
  'the public role cannot read forms directly');
reset role;

select * from finish();
rollback;
