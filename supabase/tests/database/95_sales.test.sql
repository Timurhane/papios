-- Phase 4: proposal numbers, founder slot counter, demo limits and expiry, PDF storage isolation.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into public.tenants (id, slug, name)
values ('00000000-0000-4000-8000-0000000000b2', 'tenant-b', 'Tenant B');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000aaaa', 'owner-a@example.test'),
  ('00000000-0000-4000-8000-00000000bbbb', 'owner-b@example.test');
select app.attach_owner('ajna', 'owner-a@example.test');
select app.attach_owner('tenant-b', 'owner-b@example.test');

insert into public.companies (id, tenant_id, name, name_norm, source, waiting_reason, waiting_until)
values ('00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-00000000a1a0', 'Örnek', 'ornek', 'manual', 'x', current_date);

-- numbering
insert into public.proposals (id, tenant_id, company_id, package_code, monthly_kurus, vat_mode, valid_until, founder_discount, status)
values
  ('00000000-0000-4000-8000-0000000f0001', '00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001', 'sistem', 2550000, 'excluded', current_date + 14, '{"setupPct":40,"monthlyPct":20,"monthlyMonths":3}', 'sent'),
  ('00000000-0000-4000-8000-0000000f0002', '00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001', 'refleks', 1750000, 'included', current_date + 14, '{"setupPct":40,"monthlyPct":20,"monthlyMonths":3}', 'sent');
select matches(
  (select number from public.proposals where id = '00000000-0000-4000-8000-0000000f0001'),
  '^AJNA-\d{4}-0001$', 'first proposal of the year is 0001');
select matches(
  (select number from public.proposals where id = '00000000-0000-4000-8000-0000000f0002'),
  '^AJNA-\d{4}-0002$', 'numbers increase');

-- founder slots: 3 total; fill two, accept one → full; the next one fails
update public.founder_discount set used_slots = 2 where tenant_id = '00000000-0000-4000-8000-00000000a1a0';
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"00000000-0000-4000-8000-00000000bbbb","role":"authenticated","aal":"aal2"}';
select throws_ok(
  $$ select app.accept_proposal('00000000-0000-4000-8000-0000000f0001') $$,
  '42501', null, 'other tenant cannot accept');
set local request.jwt.claims to
  '{"sub":"00000000-0000-4000-8000-00000000aaaa","role":"authenticated","aal":"aal2"}';
select ok(app.accept_proposal('00000000-0000-4000-8000-0000000f0001'), 'owner accepts');
select ok(not app.accept_proposal('00000000-0000-4000-8000-0000000f0001'), 'accepting twice does nothing');
select throws_ok(
  $$ select app.accept_proposal('00000000-0000-4000-8000-0000000f0002') $$,
  'P0001', 'Kurucu müşteri kontenjanı dolu', 'founder counter can never be exceeded');
reset role;
select is((select used_slots::int from public.founder_discount where tenant_id = '00000000-0000-4000-8000-00000000a1a0'),
  3, 'one slot consumed');

-- demos
insert into public.demos (id, tenant_id, company_id, token, snapshot, expires_at) values
  ('00000000-0000-4000-8000-0000000d0001', '00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001',
   repeat('a', 43), '{"name":"Örnek"}', now() + interval '14 days'),
  ('00000000-0000-4000-8000-0000000d0002', '00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001',
   repeat('b', 43), '{"name":"Örnek"}', now() - interval '1 minute');

select throws_ok(
  $$ insert into public.demos (tenant_id, company_id, token, snapshot, expires_at)
     values ('00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001', 'short', '{}', now()) $$,
  '23514', null, 'guessable short tokens are refused');

set local role service_role;
select is((select result from app.demo_touch(repeat('a', 43), 'visit', 2, 100)), 'ok', 'visit ok');
select is((select result from app.demo_touch(repeat('a', 43), 'message', 2, 100)), 'ok', 'message 1 ok');
select is((select result from app.demo_touch(repeat('a', 43), 'message', 2, 100)), 'ok', 'message 2 ok');
select is((select result from app.demo_touch(repeat('a', 43), 'message', 2, 100)), 'demo_limit', 'per-demo daily limit');
select is((select result from app.demo_touch(repeat('b', 43), 'visit', 2, 100)), 'expired', 'expired demo closes');
select is((select result from app.demo_touch(repeat('c', 43), 'visit', 2, 100)), 'not_found', 'unknown token');
reset role;
select is((select status from public.demos where id = '00000000-0000-4000-8000-0000000d0002'), 'closed', 'expired demo marked closed');

select throws_ok(
  $$ update public.proposals set status = 'awaiting_approval', vat_mode = null
     where id = '00000000-0000-4000-8000-0000000f0002' $$,
  '23514', null, 'a proposal cannot go to approval without the VAT answer');

set local role service_role;
select ok(app.hit_rate_limit('ip:x', 60, 2) and app.hit_rate_limit('ip:x', 60, 2), 'two hits allowed');
select ok(not app.hit_rate_limit('ip:x', 60, 2), 'third hit in the window refused');
reset role;

set local role anon;
select throws_ok($$ select app.demo_touch(repeat('a', 43), 'visit', 2, 100) $$, '42501', null,
  'demo counter is not callable by the public role');
reset role;

select * from finish();
rollback;
