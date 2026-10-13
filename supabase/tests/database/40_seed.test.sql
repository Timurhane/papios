-- Seed data matches docs/decisions.md.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select is((select name from public.tenants where slug = 'ajna'), 'AJNA Digital', 'AJNA tenant exists');

select results_eq(
  $$ select code, monthly_price_kurus from public.service_packages order by position $$,
  $$ values ('refleks', 1750000::bigint), ('sistem', 2550000::bigint),
            ('operasyon', 4000000::bigint), ('ozel', null::bigint) $$,
  'packages and prices (K-7.3)');

select is((select total_slots || '/' || used_slots from public.founder_discount), '3/0',
  'founder discount: 3 slots, none used (K-7.5)');

select is((select count(*)::int from public.playbooks), 11, '10 playbooks + partner referral sequence');
select is(
  (select count(*)::int from public.playbook_steps s join public.playbooks p on p.id = s.playbook_id
   where p.code = 'soguk_ana'), 7, 'Soğuk Ana steps as listed (V-13)');
select is(
  (select max(day_offset) from public.playbook_steps s join public.playbooks p on p.id = s.playbook_id
   where p.code = 'soguk_ana'), 21, 'Soğuk Ana lasts 21 days');
select is(
  (select count(*)::int from public.playbook_steps s join public.playbooks p on p.id = s.playbook_id
   where p.code = 'hafif_soguk'), 4, 'Hafif Soğuk has 4 touches');
select is(
  (select count(*)::int from public.playbook_steps where not requires_approval
     and channel not in ('phone_call', 'visit')), 1,
  'the only unapproved outbound step is the analysis report');
select is(
  (select approval_exempt_kind from public.playbook_steps where not requires_approval
     and channel not in ('phone_call', 'visit')), 'analysis_tool_report',
  'and it is the analysis tool report (K-2.2)');

select throws_ok(
  $$ insert into public.playbook_steps (tenant_id, playbook_id, position, day_offset, channel, angle, requires_approval)
     select tenant_id, id, 99, 1, 'email', 'x', false from public.playbooks where code = 'sinyal' $$,
  '23514', null, 'an email step cannot skip approval');

select is((select enabled from public.feature_flags where key = 'client_portal'), false,
  'client portal is off (K-13.11)');
select is((select value ->> 'mode' from public.settings where key = 'vat'), 'unspecified',
  'VAT unspecified (K-7.2)');
select is((select (value ->> 'daily_limit')::int from public.settings where key = 'email_sending'), 20,
  'daily email limit 20 (K-10.9)');
select is((select description from public.tone_profiles), '', 'tone profile starts empty (K-6.4)');

select * from finish();
rollback;
