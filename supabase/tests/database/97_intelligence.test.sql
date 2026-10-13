-- Phase 6: routine allowlist, seeded presets, signal de-duplication, internal geocode cache.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select is((select count(*)::int from public.routines where tenant_id = '00000000-0000-4000-8000-00000000a1a0'), 10,
  'ten preset routines are seeded');
select throws_ok(
  $$ insert into public.routines (tenant_id, code, name, schedule, action)
     values ('00000000-0000-4000-8000-00000000a1a0', 'kotu', 'x', '{}', 'run_sql') $$,
  '23514', null, 'routine actions are an allowlist');

insert into public.companies (id, tenant_id, name, name_norm, source, waiting_reason, waiting_until)
values ('00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-00000000a1a0', 'Örnek', 'ornek', 'manual', 'x', current_date);
insert into public.signals (tenant_id, company_id, kind, description, fingerprint)
values ('00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001', 'site_change', 'Randevu eklendi', 'booking+');
select throws_ok(
  $$ insert into public.signals (tenant_id, company_id, kind, description, fingerprint)
     values ('00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001', 'site_change', 'Randevu eklendi', 'booking+') $$,
  '23505', null, 'the same change is recorded once');
select lives_ok(
  $$ insert into public.signals (tenant_id, company_id, kind, description)
     values ('00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001', 'news', 'Yeni şube') $$,
  'signals without a fingerprint still work');

insert into public.companies (id, tenant_id, name, name_norm, source, stage, waiting_reason, waiting_until)
values ('00000000-0000-4000-8000-0000000c0002', '00000000-0000-4000-8000-00000000a1a0', 'Müşteri', 'musteri', 'manual', 'won', 'x', current_date);
insert into public.notes (tenant_id, company_id, body, source) values
  ('00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001', 'aday notu', 'panel'),
  ('00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0002', 'müşteri notu', 'panel');
select is((select array_agg(body) from app.notes_to_embed('00000000-0000-4000-8000-00000000a1a0', 10)),
  array['aday notu'], 'notes on won clients are never embedded');

set local role authenticated;
select throws_ok($$ select * from app.geocode_cache $$, '42501', null, 'geocode cache is internal');
reset role;
set local role anon;
select throws_ok($$ select * from public.routines $$, '42501', null, 'anon cannot read routines');
reset role;

select * from finish();
rollback;
