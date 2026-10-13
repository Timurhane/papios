-- Job queue claiming.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into public.jobs (tenant_id, type, heavy, run_after) values
  ('00000000-0000-4000-8000-00000000a1a0', 'light.ready', false, now() - interval '1 minute'),
  ('00000000-0000-4000-8000-00000000a1a0', 'light.later', false, now() + interval '1 hour'),
  ('00000000-0000-4000-8000-00000000a1a0', 'heavy.ready', true, now() - interval '1 minute');

set local role service_role;
select is(
  (select array_agg(type) from app.claim_jobs('worker-1', false, 10)),
  array['light.ready'], 'claims only ready light jobs');
select is(
  (select count(*)::int from app.claim_jobs('worker-2', false, 10)), 0,
  'a claimed job is not claimed twice');
select is(
  (select array_agg(type) from app.claim_jobs('actions-1', true, 10)),
  array['heavy.ready'], 'heavy jobs are claimed separately');
reset role;

select is(
  (select status::text || ':' || attempts || ':' || locked_by from public.jobs where type = 'light.ready'),
  'running:1:worker-1', 'claim marks running, increments attempts, records worker');
select is((select status::text from public.jobs where type = 'light.later'), 'queued',
  'future jobs stay queued');

select * from finish();
rollback;
