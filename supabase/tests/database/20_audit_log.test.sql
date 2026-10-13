-- Audit log: every config change is recorded, and the log is append-only (K-2.6, K-17.6).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000aaaa', 'owner-a@example.test');
select app.attach_owner('ajna', 'owner-a@example.test');

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"00000000-0000-4000-8000-00000000aaaa","role":"authenticated","aal":"aal2"}';
update public.settings set value = '{"mode":"excluded"}' where key = 'vat';
reset role;

select is(
  (select actor_type || ':' || actor_id from public.audit_log
   where action = 'settings.update' and entity_id = 'vat' order by id desc limit 1),
  'user:00000000-0000-4000-8000-00000000aaaa',
  'user setting change is audited with the user as actor');

set local app.actor = 'agent:ulak';
insert into public.banned_phrases (tenant_id, phrase)
values ('00000000-0000-4000-8000-00000000a1a0', 'hemen arayın');
select is(
  (select actor_type || ':' || actor_id from public.audit_log
   where action = 'banned_phrases.insert' order by id desc limit 1),
  'agent:ulak', 'agent actions are attributed to the agent');

select throws_ok($$ update public.audit_log set action = 'x' $$, '42501', null,
  'audit_log rows cannot be updated, even by the owner role');
select throws_ok($$ delete from public.audit_log $$, '42501', null,
  'audit_log rows cannot be deleted');
select throws_ok($$ truncate public.audit_log $$, '42501', null,
  'audit_log cannot be truncated');

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"00000000-0000-4000-8000-00000000aaaa","role":"authenticated","aal":"aal2"}';
select ok((select count(*) from public.audit_log) > 0, 'owner can read own audit log');
select throws_ok($$ delete from public.audit_log $$, '42501', null,
  'authenticated users cannot delete audit rows');

select * from finish();
rollback;
