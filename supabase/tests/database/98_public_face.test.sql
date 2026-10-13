-- Phase 7: analysis tool requests are internal (RLS); public pages reach them only through the Worker.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into public.tool_requests (tenant_id, email, query, consent_at, consent_version, token_hash, expires_at)
values ('00000000-0000-4000-8000-00000000a1a0', 'a@b.com', 'ornek.com', now(), '2026-10', 'h1', now() + interval '30 days');
select throws_ok(
  $$ insert into public.tool_requests (tenant_id, email, query, consent_at, consent_version, token_hash, expires_at)
     values ('00000000-0000-4000-8000-00000000a1a0', 'c@d.com', 'x.com', now(), '2026-10', 'h1', now()) $$,
  '23505', null, 'report token hashes are unique');

set local role anon;
select throws_ok($$ select * from public.tool_requests $$, '42501', null, 'anon cannot read tool requests');
reset role;
set local role authenticated;
select is((select count(*)::int from public.tool_requests), 0, 'a session without tenant access sees nothing');
reset role;

select * from finish();
rollback;
