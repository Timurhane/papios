-- Phase 3 panel: approval decisions, one-click completion and step stats respect tenant + aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into public.tenants (id, slug, name)
values ('00000000-0000-4000-8000-0000000000b2', 'tenant-b', 'Tenant B');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000aaaa', 'owner-a@example.test'),
  ('00000000-0000-4000-8000-00000000bbbb', 'owner-b@example.test');
select app.attach_owner('ajna', 'owner-a@example.test');
select app.attach_owner('tenant-b', 'owner-b@example.test');

insert into public.companies (id, tenant_id, name, name_norm, source, waiting_reason, waiting_until)
values ('00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-00000000a1a0', 'Örnek', 'ornek', 'manual', 'x', current_date);
insert into public.approvals (id, tenant_id, kind, title, payload) values
  ('00000000-0000-4000-8000-0000000a0001', '00000000-0000-4000-8000-00000000a1a0', 'outreach', 'Mail: Örnek', '{"text":"Merhaba"}'),
  ('00000000-0000-4000-8000-0000000a0002', '00000000-0000-4000-8000-00000000a1a0', 'outreach', 'Mail: Örnek 2', '{}');
insert into public.touches (id, tenant_id, company_id, channel, recipient, status) values
  ('00000000-0000-4000-8000-0000000e0001', '00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001', 'whatsapp', '905321112233', 'ready'),
  ('00000000-0000-4000-8000-0000000e0002', '00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001', 'whatsapp', '905329998877', 'ready');

-- Tenant B cannot decide AJNA approvals or complete AJNA touches.
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"00000000-0000-4000-8000-00000000bbbb","role":"authenticated","aal":"aal2"}';
select throws_ok(
  $$ select app.panel_decide_approval('00000000-0000-4000-8000-0000000a0001', 'approved') $$,
  '42501', null, 'other tenant cannot decide');
select throws_ok(
  $$ select app.panel_complete_touch('00000000-0000-4000-8000-0000000e0001', 'sent') $$,
  '42501', null, 'other tenant cannot complete a touch');

-- AJNA owner without TOTP (aal1) cannot either.
set local request.jwt.claims to
  '{"sub":"00000000-0000-4000-8000-00000000aaaa","role":"authenticated","aal":"aal1"}';
select throws_ok(
  $$ select app.panel_decide_approval('00000000-0000-4000-8000-0000000a0001', 'approved') $$,
  '42501', null, 'aal1 cannot decide');

set local request.jwt.claims to
  '{"sub":"00000000-0000-4000-8000-00000000aaaa","role":"authenticated","aal":"aal2"}';
select ok(
  app.panel_decide_approval('00000000-0000-4000-8000-0000000a0001', 'approved',
    '{"text":"Merhaba, düzenlendi","subject":"Konu"}'),
  'owner approves with an edit');
select ok(
  not app.panel_decide_approval('00000000-0000-4000-8000-0000000a0001', 'rejected'),
  'a decided approval cannot be decided again');
select throws_ok(
  $$ select app.panel_decide_approval('00000000-0000-4000-8000-0000000a0002', 'approved', '{"text":""}') $$,
  null, 'an empty edit is refused');
select ok(app.panel_complete_touch('00000000-0000-4000-8000-0000000e0001', 'sent'), 'owner marks a WhatsApp sent');
select ok(
  not app.panel_complete_touch('00000000-0000-4000-8000-0000000e0001', 'sent'),
  'an item is completed only once');
reset role;

select is(
  (select payload -> 'edited' ->> 'text' || '|' || decided_via from public.approvals
   where id = '00000000-0000-4000-8000-0000000a0001'),
  'Merhaba, düzenlendi|panel', 'edit and channel are stored');

-- A recipient suppressed meanwhile: completion is refused and the item cancelled.
select app.suppress('00000000-0000-4000-8000-00000000a1a0', 'phone', '905329998877', 'asked_not_to_contact');
set local role authenticated;
select ok(
  not app.panel_complete_touch('00000000-0000-4000-8000-0000000e0002', 'sent'),
  'suppressed recipient cannot be marked sent');
reset role;
select is(
  (select status from public.touches where id = '00000000-0000-4000-8000-0000000e0002'),
  'cancelled', 'the suppressed item is cancelled');

set local role anon;
select throws_ok($$ select * from public.playbook_step_stats $$, '42501', null, 'anon cannot read step stats');
reset role;

select * from finish();
rollback;
