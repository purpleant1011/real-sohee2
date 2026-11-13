-- Preserve the canonical append-only ledger and legacy RPC; record the actual provider for new calls.
alter table public.ai_usage_events drop constraint if exists ai_usage_events_provider_check;
alter table public.ai_usage_events add constraint ai_usage_events_provider_check
  check (provider in ('openai', 'gemini'));

create or replace function public.record_ai_usage_event_v2(
  p_workspace_id uuid,
  p_job_id uuid,
  p_message_id uuid,
  p_provider_call_key text,
  p_provider_request_id text,
  p_model text,
  p_operation text,
  p_text_input_tokens integer,
  p_cached_text_input_tokens integer,
  p_text_output_tokens integer,
  p_image_input_tokens integer,
  p_image_output_tokens integer,
  p_provider_total_tokens integer,
  p_usage_source text,
  p_policy_version text,
  p_computed_credits integer,
  p_provider text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_usage public.ai_usage_events%rowtype;
begin
  if p_provider is null or p_provider not in ('openai', 'gemini') then
    raise exception 'AI_USAGE_PROVIDER_INVALID' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.conversation_jobs
    where id = p_job_id and workspace_id = p_workspace_id and assistant_message_id = p_message_id
  ) then
    raise exception 'AI_USAGE_JOB_MISMATCH' using errcode = '22023';
  end if;

  insert into public.ai_usage_events (
    workspace_id, job_id, message_id, provider, model, operation,
    provider_request_id, provider_call_key, text_input_tokens,
    cached_text_input_tokens, text_output_tokens, image_input_tokens,
    image_output_tokens, provider_total_tokens, usage_source,
    policy_version, computed_credits
  ) values (
    p_workspace_id, p_job_id, p_message_id, p_provider, p_model, p_operation,
    p_provider_request_id, p_provider_call_key, p_text_input_tokens,
    p_cached_text_input_tokens, p_text_output_tokens, p_image_input_tokens,
    p_image_output_tokens, p_provider_total_tokens, p_usage_source,
    p_policy_version, p_computed_credits
  ) on conflict (workspace_id, provider_call_key) do nothing;

  select * into v_usage from public.ai_usage_events
  where workspace_id = p_workspace_id and provider_call_key = p_provider_call_key;

  if (v_usage.job_id, v_usage.message_id, v_usage.provider, v_usage.model,
      v_usage.operation, v_usage.provider_request_id,
      v_usage.text_input_tokens, v_usage.cached_text_input_tokens, v_usage.text_output_tokens,
      v_usage.image_input_tokens, v_usage.image_output_tokens, v_usage.provider_total_tokens,
      v_usage.usage_source, v_usage.policy_version, v_usage.computed_credits)
    is distinct from
     (p_job_id, p_message_id, p_provider, p_model,
      p_operation, p_provider_request_id,
      p_text_input_tokens, p_cached_text_input_tokens, p_text_output_tokens,
      p_image_input_tokens, p_image_output_tokens, p_provider_total_tokens,
      p_usage_source, p_policy_version, p_computed_credits)
  then
    raise exception 'AI_USAGE_IDEMPOTENCY_CONFLICT' using errcode = '23505';
  end if;
  return true;
end;
$$;

revoke all on function public.record_ai_usage_event_v2(
  uuid, uuid, uuid, text, text, text, text,
  integer, integer, integer, integer, integer, integer, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.record_ai_usage_event_v2(
  uuid, uuid, uuid, text, text, text, text,
  integer, integer, integer, integer, integer, integer, text, text, integer, text
) to service_role;
