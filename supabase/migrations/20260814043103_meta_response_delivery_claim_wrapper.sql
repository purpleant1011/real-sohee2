alter function public.approve_and_claim_channel_response(uuid, uuid, text, text, text, text)
  set schema private;

revoke all on function private.approve_and_claim_channel_response(uuid, uuid, text, text, text, text)
  from public, anon;
grant execute on function private.approve_and_claim_channel_response(uuid, uuid, text, text, text, text)
  to authenticated;

create function public.approve_and_claim_channel_response(
  p_workspace_id uuid,
  p_response_job_id uuid,
  p_draft_text text,
  p_draft_fingerprint text,
  p_claim_token text,
  p_idempotency_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.approve_and_claim_channel_response(
    p_workspace_id,
    p_response_job_id,
    p_draft_text,
    p_draft_fingerprint,
    p_claim_token,
    p_idempotency_key
  );
$$;

revoke all on function public.approve_and_claim_channel_response(uuid, uuid, text, text, text, text)
  from public, anon;
grant execute on function public.approve_and_claim_channel_response(uuid, uuid, text, text, text, text)
  to authenticated;
