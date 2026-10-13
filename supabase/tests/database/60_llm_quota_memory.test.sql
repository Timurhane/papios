-- Phase 1: quota reservation, vector + keyword search, permissions on bookkeeping tables.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- Quota: rpm = 2 allows exactly two calls in the same minute.
select ok(app.consume_quota('00000000-0000-4000-8000-00000000a1a0', 'gemini', 2, 100), 'first call allowed');
select ok(app.consume_quota('00000000-0000-4000-8000-00000000a1a0', 'gemini', 2, 100), 'second call allowed');
select ok(not app.consume_quota('00000000-0000-4000-8000-00000000a1a0', 'gemini', 2, 100), 'third call refused (rpm)');
select ok(app.consume_quota('00000000-0000-4000-8000-00000000a1a0', 'groq', 10, 1), 'other provider unaffected');
select ok(not app.consume_quota('00000000-0000-4000-8000-00000000a1a0', 'groq', 10, 1), 'daily limit enforced');
select ok(not app.consume_quota('00000000-0000-4000-8000-00000000a1a0', 'new', null, null),
  'unconfigured limits fail closed');

-- Keyword search finds the seeded slogan without any embedding.
select is(
  (select title from app.search_knowledge_text('00000000-0000-4000-8000-00000000a1a0', 'refleks', 1)),
  'Slogan', 'keyword fallback finds the slogan');

-- Vector search ranks the nearest item first.
update public.knowledge_items set embedding = array_fill(0.0::real, array[768])::extensions.vector
where tenant_id = '00000000-0000-4000-8000-00000000a1a0';
update public.knowledge_items
set embedding = (array[1.0::real] || array_fill(0.0::real, array[767]))::extensions.vector
where title = 'Slogan';
select is(
  (select title from app.match_knowledge('00000000-0000-4000-8000-00000000a1a0',
     (array[1.0::real] || array_fill(0.0::real, array[767]))::extensions.vector, 1)),
  'Slogan', 'vector search returns the closest item');

-- Users cannot write bookkeeping tables or call quota reservation.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000aaaa', 'owner-a@example.test');
select app.attach_owner('ajna', 'owner-a@example.test');
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"00000000-0000-4000-8000-00000000aaaa","role":"authenticated","aal":"aal2"}';
select throws_ok(
  $$ insert into public.llm_calls (tenant_id, agent, task, tier, data_class, status)
     values ('00000000-0000-4000-8000-00000000a1a0', 'x', 'x', 'light', 'public', 'ok') $$,
  '42501', null, 'users cannot forge llm_calls');
select throws_ok(
  $$ select app.consume_quota('00000000-0000-4000-8000-00000000a1a0', 'gemini', 100, 100) $$,
  '42501', null, 'users cannot reserve quota');
select ok((select count(*) from public.quota_usage) > 0, 'owner can read quota usage');

select * from finish();
rollback;
