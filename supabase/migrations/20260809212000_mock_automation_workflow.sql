alter table public.automation_rules
  drop constraint if exists automation_rules_kind_check;

alter table public.automation_rules
  add constraint automation_rules_kind_check
  check (kind in ('faq_safe_reply', 'schedule_reminder', 'content_draft'));

create or replace function public.save_automation_rule(
  p_workspace_id uuid,
  p_rule_id uuid,
  p_kind text,
  p_active boolean,
  p_approval_required boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
begin
  if not (select private.has_workspace_role(p_workspace_id, array['owner', 'manager']::text[])) then
    raise exception using errcode = '42501', message = 'automation_rule_forbidden';
  end if;
  if p_kind not in ('faq_safe_reply', 'schedule_reminder', 'content_draft') then
    raise exception using errcode = '22023', message = 'automation_kind_invalid';
  end if;
  if p_kind = 'content_draft' and not p_approval_required then
    raise exception using errcode = '23514', message = 'automation_approval_required';
  end if;

  if p_rule_id is null then
    insert into public.automation_rules (
      workspace_id, kind, active, approval_required, configuration, created_by
    ) values (
      p_workspace_id, p_kind, p_active, p_approval_required,
      jsonb_build_object('mode', 'mock'), (select auth.uid())
    ) returning id into saved_id;
  else
    update public.automation_rules
    set kind = p_kind,
        active = p_active,
        approval_required = p_approval_required,
        configuration = jsonb_build_object('mode', 'mock')
    where workspace_id = p_workspace_id and id = p_rule_id
    returning id into saved_id;
    if saved_id is null then
      raise exception using errcode = 'P0002', message = 'automation_rule_not_found';
    end if;
  end if;
  return saved_id;
end;
$$;

create or replace function public.run_mock_automation(
  p_workspace_id uuid,
  p_rule_id uuid,
  p_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_rule public.automation_rules%rowtype;
  run_id uuid;
  final_status text;
  final_error text;
  final_summary text;
begin
  if not (select private.has_workspace_role(p_workspace_id, array['owner', 'manager']::text[])) then
    raise exception using errcode = '42501', message = 'automation_run_forbidden';
  end if;
  if p_outcome not in ('success', 'failure') then
    raise exception using errcode = '22023', message = 'automation_outcome_invalid';
  end if;
  select * into current_rule from public.automation_rules
  where workspace_id = p_workspace_id and id = p_rule_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'automation_rule_not_found'; end if;
  if not current_rule.active then raise exception using errcode = '23514', message = 'automation_rule_inactive'; end if;

  if p_outcome = 'failure' then
    final_status := 'failed';
    final_error := 'mock_provider_unavailable';
    final_summary := '모의 제공자 연결에 실패했습니다.';
  elsif current_rule.kind = 'content_draft' then
    final_status := 'awaiting_approval';
    final_error := null;
    final_summary := '모의 초안을 준비했습니다. 사람의 승인이 필요합니다.';
  else
    final_status := 'succeeded';
    final_error := null;
    final_summary := '외부 전송 없이 모의 실행을 완료했습니다.';
  end if;

  insert into public.automation_runs (
    workspace_id, rule_id, status, input_summary, output_summary,
    error_code, finished_at
  ) values (
    p_workspace_id, p_rule_id, final_status,
    jsonb_build_object('mode', 'mock', 'requestedOutcome', p_outcome),
    jsonb_build_object('mode', 'mock', 'summary', final_summary),
    final_error, statement_timestamp()
  ) returning id into run_id;

  return jsonb_build_object('runId', run_id, 'status', final_status, 'errorCode', final_error);
end;
$$;

revoke execute on function public.save_automation_rule(uuid, uuid, text, boolean, boolean) from public, anon;
grant execute on function public.save_automation_rule(uuid, uuid, text, boolean, boolean) to authenticated;
revoke execute on function public.run_mock_automation(uuid, uuid, text) from public, anon;
grant execute on function public.run_mock_automation(uuid, uuid, text) to authenticated;
