-- K-10.13: a suppressed person/company can never get a message approved, scheduled or sent.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.companies (id, tenant_id, name, name_norm, source, domain, waiting_reason, waiting_until)
values ('00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-00000000a1a0', 'Örnek', 'ornek', 'manual', 'ornek.com', 'x', current_date),
       ('00000000-0000-4000-8000-0000000c0002', '00000000-0000-4000-8000-00000000a1a0', 'Başka', 'baska', 'manual', 'baska.com', 'x', current_date);

select app.suppress('00000000-0000-4000-8000-00000000a1a0', 'email', 'Ali@Ornek.com', 'asked_not_to_contact');
select app.suppress('00000000-0000-4000-8000-00000000a1a0', 'phone', '0532 123 45 67', 'asked_not_to_contact');
select app.suppress('00000000-0000-4000-8000-00000000a1a0', 'company', '00000000-0000-4000-8000-0000000c0002', 'asked_not_to_contact');

select lives_ok(
  $$ insert into public.touches (tenant_id, company_id, channel, recipient, status)
     values ('00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001', 'email', 'ali@ornek.com', 'drafted') $$,
  'a draft may exist (nothing is sent)');
select throws_ok(
  $$ update public.touches set status = 'approved' where recipient = 'ali@ornek.com' $$,
  'P0001', null, 'suppressed email cannot be approved');
select throws_ok(
  $$ insert into public.touches (tenant_id, company_id, channel, recipient, status)
     values ('00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001', 'email', 'ALI@ornek.com', 'sent') $$,
  'P0001', null, 'suppressed email cannot be marked sent, whatever the case');
select throws_ok(
  $$ insert into public.touches (tenant_id, company_id, channel, recipient, status)
     values ('00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001', 'whatsapp', '+90 532 123 45 67', 'ready') $$,
  'P0001', null, 'suppressed phone blocks WhatsApp');
select throws_ok(
  $$ insert into public.touches (tenant_id, company_id, channel, recipient, status)
     values ('00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001', 'phone_call', '05321234567', 'ready') $$,
  'P0001', null, 'suppressed phone blocks calls');
select throws_ok(
  $$ insert into public.touches (tenant_id, company_id, channel, recipient, status)
     values ('00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0002', 'email', 'yeni@baska.com', 'approved') $$,
  'P0001', null, 'a suppressed company blocks every channel and person');
select lives_ok(
  $$ insert into public.touches (tenant_id, company_id, channel, recipient, status)
     values ('00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001', 'email', 'veli@ornek.com', 'approved') $$,
  'other people are unaffected');

-- Domain-level suppression (company asked not to be contacted at all).
select app.suppress('00000000-0000-4000-8000-00000000a1a0', 'domain', 'ornek.com', 'asked_not_to_contact');
select throws_ok(
  $$ insert into public.touches (tenant_id, company_id, channel, recipient, status)
     values ('00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001', 'email', 'yeni@ornek.com', 'scheduled') $$,
  'P0001', null, 'suppressed domain blocks new addresses at that domain');

-- Even the service role (workers) cannot bypass the trigger.
set local role service_role;
select throws_ok(
  $$ insert into public.touches (tenant_id, company_id, channel, recipient, status)
     values ('00000000-0000-4000-8000-00000000a1a0', '00000000-0000-4000-8000-0000000c0001', 'email', 'ali@ornek.com', 'sent') $$,
  'P0001', null, 'service role cannot bypass suppression');
reset role;

select * from finish();
rollback;
