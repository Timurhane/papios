-- Global suppression list (K-2.7, K-10.13): normalized, hashed, permanent.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select is(app.normalize_contact('phone', '0532 123 45 67'), '905321234567', 'TR phone with leading 0');
select is(app.normalize_contact('phone', '+90 (532) 123-45-67'), '905321234567', 'TR phone with +90');
select is(app.normalize_contact('phone', '5321234567'), '905321234567', 'TR phone without prefix');
select is(app.normalize_contact('email', '  Ali@Ornek.COM '), 'ali@ornek.com', 'email lowercased and trimmed');
select is(app.normalize_contact('domain', 'https://www.Ornek.com.tr/iletisim?x=1'), 'ornek.com.tr', 'domain stripped');

insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000aaaa', 'owner-a@example.test');
select app.attach_owner('ajna', 'owner-a@example.test');

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"00000000-0000-4000-8000-00000000aaaa","role":"authenticated","aal":"aal2"}';

select app.suppress('00000000-0000-4000-8000-00000000a1a0', 'email', 'Ali@Ornek.com', 'asked_not_to_contact', 'test');
select ok(app.is_suppressed('00000000-0000-4000-8000-00000000a1a0', 'email', 'ali@ornek.com'),
  'suppressed regardless of case');
select ok(not app.is_suppressed('00000000-0000-4000-8000-00000000a1a0', 'email', 'veli@ornek.com'),
  'other addresses are not suppressed');
select is(
  (select count(*)::int from public.suppression_list where value_hash like '%ali%'), 0,
  'raw value is never stored');

delete from public.suppression_list;
update public.suppression_list set reason = 'manual';
reset role;
select is((select count(*)::int from public.suppression_list), 1,
  'users cannot delete suppression entries');
select is((select reason from public.suppression_list limit 1), 'asked_not_to_contact',
  'users cannot alter suppression entries');

select * from finish();
rollback;
