-- Phase 3 panel: approve/edit/reject outreach drafts and complete one-click items from the panel,
-- plus per-step playbook performance. The functions check tenant access (membership + aal2) and only
-- touch rows in the expected state; the Worker does the rest (scheduling, style memory).

-- Panel approval decision. An optional hand edit ({"text": ..., "subject": ...}) is stored in the
-- payload; the Worker copies it onto the touch before scheduling (reconcilePanelDecisions).
create function app.panel_decide_approval(p_id uuid, p_status text, p_edited jsonb default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if p_status not in ('approved', 'rejected') then
    raise exception 'invalid status %', p_status;
  end if;
  if p_edited is not null and (
    jsonb_typeof(p_edited) <> 'object'
    or jsonb_typeof(p_edited -> 'text') is distinct from 'string'
    or length(btrim(p_edited ->> 'text')) = 0
    or length(p_edited ->> 'text') > 5000
  ) then
    raise exception 'edited must be {"text": "...", "subject"?: "..."}';
  end if;
  select tenant_id into v_tenant from public.approvals where id = p_id;
  if v_tenant is null or not app.can_access_tenant(v_tenant) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.approvals
  set status = p_status,
      decided_at = now(),
      decided_via = 'panel',
      payload = case
        when p_edited is null or p_status <> 'approved' then payload
        else payload || jsonb_build_object('edited', p_edited)
      end
  where id = p_id and status = 'pending';
  return found;
end;
$$;
revoke all on function app.panel_decide_approval(uuid, text, jsonb) from public;
grant execute on function app.panel_decide_approval(uuid, text, jsonb) to authenticated;

-- K-10.16: "Gönderdim / Aradım / Atla" from the panel. Suppression is still enforced by the touches
-- trigger; a suppressed recipient turns the item into 'cancelled' and the function returns false.
create function app.panel_complete_touch(p_touch_id uuid, p_action text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_touch public.touches;
begin
  if p_action not in ('sent', 'skip') then
    raise exception 'invalid action %', p_action;
  end if;
  select * into v_touch from public.touches where id = p_touch_id;
  if v_touch.id is null or not app.can_access_tenant(v_touch.tenant_id) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_touch.status <> 'ready' then
    return false;
  end if;
  if p_action = 'skip' then
    update public.touches set status = 'skipped', skip_reason = 'Timurhan atladı' where id = p_touch_id;
    return true;
  end if;
  begin
    update public.touches set status = 'sent', sent_at = now() where id = p_touch_id;
  exception when sqlstate 'P0001' then
    update public.touches
    set status = 'cancelled', skip_reason = 'Alıcı reddedenler listesinde'
    where id = p_touch_id;
    return false;
  end;
  insert into public.company_events (tenant_id, company_id, kind, summary)
  values (v_touch.tenant_id, v_touch.company_id, 'touch_sent', 'Tek tık temas panelden tamamlandı');
  return true;
end;
$$;
revoke all on function app.panel_complete_touch(uuid, text) from public;
grant execute on function app.panel_complete_touch(uuid, text) to authenticated;

-- Per-step performance (K-11.x panel): touches by state and replies per step. security_invoker keeps
-- the caller's RLS in force.
create view public.playbook_step_stats with (security_invoker = true) as
select
  s.tenant_id,
  s.playbook_id,
  s.position,
  s.channel,
  s.angle,
  s.day_offset,
  count(distinct t.id) filter (where t.status = 'sent')::int as sent,
  count(distinct t.id) filter (where t.status in ('skipped', 'cancelled', 'failed'))::int as skipped,
  count(distinct t.id) filter (
    where t.status in ('drafted', 'awaiting_approval', 'approved', 'scheduled', 'ready')
  )::int as pending,
  count(distinct m.id) filter (where m.classification is distinct from 'auto_reply')::int as replies,
  count(distinct m.id) filter (where m.classification in ('interested', 'question'))::int as positive
from public.playbook_steps s
left join public.enrollments e on e.playbook_id = s.playbook_id and e.tenant_id = s.tenant_id
left join public.touches t on t.enrollment_id = e.id and t.step_position = s.position
left join public.inbox_messages m on m.touch_id = t.id
group by s.id;
revoke all on public.playbook_step_stats from anon;
grant select on public.playbook_step_stats to authenticated;
