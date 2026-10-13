-- Phase 1: LLM bookkeeping, quotas, cache, errors, conversation, approvals, memory, runtime state.

-- Every LLM call (K-4.8). Append-only for users.
create table public.llm_calls (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  created_at timestamptz not null default now(),
  agent text not null,
  task text not null,
  tier text not null check (tier in ('light', 'medium', 'heavy', 'embed', 'transcribe', 'speak')),
  provider text,
  model text,
  data_class text not null check (data_class in ('public', 'internal', 'personal', 'client_sensitive')),
  tokens_in integer not null default 0 check (tokens_in >= 0),
  tokens_out integer not null default 0 check (tokens_out >= 0),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  cached boolean not null default false,
  status text not null check (status in ('ok', 'error', 'rate_limited', 'blocked', 'quota_exhausted')),
  error text,
  prompt_id text,
  prompt_version integer
);
create index llm_calls_tenant_time_idx on public.llm_calls (tenant_id, created_at desc);

-- Result cache keyed by input hash (K-4.5).
create table public.llm_cache (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text not null check (key ~ '^[0-9a-f]{64}$'),
  value jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  primary key (tenant_id, key)
);

-- Request counters per provider and window (K-4.4).
create table public.quota_usage (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  provider text not null,
  window_kind text not null check (window_kind in ('minute', 'day')),
  window_start timestamptz not null,
  count integer not null default 0 check (count >= 0),
  primary key (tenant_id, provider, window_kind, window_start)
);

-- Atomically reserves one request if both the minute and day windows have room.
-- Null limits mean "not configured": the request is refused (fail closed).
create function app.consume_quota(
  p_tenant_id uuid,
  p_provider text,
  p_rpm integer,
  p_rpd integer,
  p_day_timezone text default 'UTC'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minute timestamptz := date_trunc('minute', now());
  v_day timestamptz := (date_trunc('day', now() at time zone p_day_timezone)) at time zone p_day_timezone;
  v_minute_count integer;
  v_day_count integer;
begin
  if p_rpm is null or p_rpd is null then
    return false;
  end if;

  insert into public.quota_usage (tenant_id, provider, window_kind, window_start, count)
  values (p_tenant_id, p_provider, 'minute', v_minute, 0), (p_tenant_id, p_provider, 'day', v_day, 0)
  on conflict do nothing;

  select count into v_minute_count from public.quota_usage
  where tenant_id = p_tenant_id and provider = p_provider and window_kind = 'minute' and window_start = v_minute
  for update;
  select count into v_day_count from public.quota_usage
  where tenant_id = p_tenant_id and provider = p_provider and window_kind = 'day' and window_start = v_day
  for update;

  if v_minute_count >= p_rpm or v_day_count >= p_rpd then
    return false;
  end if;

  update public.quota_usage set count = count + 1
  where tenant_id = p_tenant_id and provider = p_provider
    and ((window_kind = 'minute' and window_start = v_minute) or (window_kind = 'day' and window_start = v_day));
  return true;
end;
$$;
revoke all on function app.consume_quota(uuid, text, integer, integer, text) from public;
grant execute on function app.consume_quota(uuid, text, integer, integer, text) to service_role;

-- Own error tracking (K-3.13 change).
create table public.error_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  created_at timestamptz not null default now(),
  source text not null,
  severity text not null check (severity in ('warning', 'error', 'critical')),
  message text not null,
  context jsonb not null default '{}'::jsonb,
  notified_at timestamptz
);
create index error_events_tenant_time_idx on public.error_events (tenant_id, created_at desc);

-- Short-term conversation memory with Papi.
create table public.conversation_messages (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  channel text not null check (channel in ('telegram', 'panel', 'voice')),
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index conversation_messages_recent_idx on public.conversation_messages (tenant_id, channel, created_at desc);

-- Approval queue (K-2.1). Execution of approved items arrives with the senders (Phase 3+).
create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null,
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'needs_revision', 'superseded', 'done')),
  batch_id uuid,
  created_by_agent text,
  supersedes uuid references public.approvals (id),
  correction text,
  decided_at timestamptz,
  decided_via text check (decided_via in ('telegram', 'panel')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index approvals_pending_idx on public.approvals (tenant_id, created_at) where status = 'pending';
create trigger approvals_touch before update on public.approvals
  for each row execute function app.touch_updated_at();

-- Style memory (K-6.8).
create table public.style_memory (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  draft_kind text not null,
  original text not null,
  revised text,
  instruction text,
  verdict text not null check (verdict in ('approved', 'edited', 'rejected')),
  embedding extensions.vector(768),
  created_at timestamptz not null default now()
);

-- Company/contact memory (K-6.7). subject_id gets a foreign key when CRM tables arrive (Phase 2).
create table public.memory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  subject_type text not null check (subject_type in ('company', 'contact', 'general')),
  subject_id uuid,
  kind text not null check (kind in ('analysis', 'touch', 'reply', 'meeting_note', 'proposal', 'note')),
  content text not null,
  embedding extensions.vector(768),
  created_at timestamptz not null default now()
);
create index memory_items_subject_idx on public.memory_items (tenant_id, subject_type, subject_id);

-- Small runtime flags such as quiet mode (K-15.5).
create table public.runtime_state (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);
create trigger runtime_state_touch before update on public.runtime_state
  for each row execute function app.touch_updated_at();

-- RLS: members (aal2) read everything; users may decide approvals and curate memory.
do $$
declare
  t text;
begin
  foreach t in array array[
    'llm_calls', 'llm_cache', 'quota_usage', 'error_events', 'conversation_messages',
    'approvals', 'style_memory', 'memory_items', 'runtime_state'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (app.can_access_tenant(tenant_id))',
      t || '_select', t);
  end loop;
end;
$$;

create policy approvals_update on public.approvals for update to authenticated
  using (app.can_access_tenant(tenant_id)) with check (app.can_access_tenant(tenant_id));
create policy style_memory_rw on public.style_memory for all to authenticated
  using (app.can_access_tenant(tenant_id)) with check (app.can_access_tenant(tenant_id));
create policy memory_items_rw on public.memory_items for all to authenticated
  using (app.can_access_tenant(tenant_id)) with check (app.can_access_tenant(tenant_id));

revoke insert, update, delete on public.llm_calls, public.llm_cache, public.quota_usage,
  public.error_events, public.conversation_messages, public.runtime_state from authenticated;
revoke all on public.llm_calls, public.llm_cache, public.quota_usage, public.error_events,
  public.conversation_messages, public.approvals, public.style_memory, public.memory_items,
  public.runtime_state from anon;

create trigger approvals_audit after insert or update or delete on public.approvals
  for each row execute function app.audit_row_change();
create trigger runtime_state_audit after insert or update or delete on public.runtime_state
  for each row execute function app.audit_row_change();

-- Similarity search. Invoker rights: RLS still applies for panel users.
create function app.match_knowledge(p_tenant_id uuid, p_embedding extensions.vector, p_limit integer default 5)
returns table (id uuid, kind public.knowledge_kind, title text, content text, similarity double precision)
language sql
stable
set search_path = ''
as $$
  select k.id, k.kind, k.title, k.content,
         1 - (k.embedding operator(extensions.<=>) p_embedding) as similarity
  from public.knowledge_items k
  where k.tenant_id = p_tenant_id and k.embedding is not null and not k.is_template
  order by k.embedding operator(extensions.<=>) p_embedding
  limit greatest(p_limit, 0);
$$;

create function app.match_memory(
  p_tenant_id uuid, p_embedding extensions.vector, p_subject_id uuid default null, p_limit integer default 5)
returns table (id uuid, subject_type text, subject_id uuid, kind text, content text, similarity double precision)
language sql
stable
set search_path = ''
as $$
  select m.id, m.subject_type, m.subject_id, m.kind, m.content,
         1 - (m.embedding operator(extensions.<=>) p_embedding)
  from public.memory_items m
  where m.tenant_id = p_tenant_id and m.embedding is not null
    and (p_subject_id is null or m.subject_id = p_subject_id)
  order by m.embedding operator(extensions.<=>) p_embedding
  limit greatest(p_limit, 0);
$$;

create function app.match_style(
  p_tenant_id uuid, p_embedding extensions.vector, p_draft_kind text, p_limit integer default 3)
returns table (id uuid, original text, revised text, instruction text, verdict text, similarity double precision)
language sql
stable
set search_path = ''
as $$
  select s.id, s.original, s.revised, s.instruction, s.verdict,
         1 - (s.embedding operator(extensions.<=>) p_embedding)
  from public.style_memory s
  where s.tenant_id = p_tenant_id and s.embedding is not null and s.draft_kind = p_draft_kind
    and s.verdict <> 'approved'
  order by s.embedding operator(extensions.<=>) p_embedding
  limit greatest(p_limit, 0);
$$;

-- Keyword fallback when no embedding is available (rule before model, K-2.3).
create function app.search_knowledge_text(p_tenant_id uuid, p_query text, p_limit integer default 5)
returns table (id uuid, kind public.knowledge_kind, title text, content text, rank real)
language sql
stable
set search_path = ''
as $$
  select k.id, k.kind, k.title, k.content,
         ts_rank(to_tsvector('simple', k.title || ' ' || k.content), plainto_tsquery('simple', p_query)) as rank
  from public.knowledge_items k
  where k.tenant_id = p_tenant_id and not k.is_template
    and (to_tsvector('simple', k.title || ' ' || k.content) @@ plainto_tsquery('simple', p_query)
         or k.title ilike '%' || p_query || '%' or k.content ilike '%' || p_query || '%')
  order by rank desc
  limit greatest(p_limit, 0);
$$;

grant execute on function app.match_knowledge(uuid, extensions.vector, integer) to authenticated, service_role;
grant execute on function app.match_memory(uuid, extensions.vector, uuid, integer) to authenticated, service_role;
grant execute on function app.match_style(uuid, extensions.vector, text, integer) to authenticated, service_role;
grant execute on function app.search_knowledge_text(uuid, text, integer) to authenticated, service_role;
