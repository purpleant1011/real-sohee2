-- Migration: 20260907050000_v089_evidence_gated_channel_verification.sql
-- Description: [ANI-997] Evidence-Gated Channel Verification RPC + Lineage Integrity

-- 1. Index and Foreign Key on channel_verification_runs
CREATE INDEX IF NOT EXISTS idx_channel_verification_runs_ws_request
  ON public.channel_verification_runs (workspace_id, action_request_id, status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'channel_verification_runs_action_request_fkey'
  ) THEN
    ALTER TABLE public.channel_verification_runs
      ADD CONSTRAINT channel_verification_runs_action_request_fkey
      FOREIGN KEY (workspace_id, action_request_id)
      REFERENCES public.external_action_requests (workspace_id, id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

-- 2. Evidence-Gated Channel Verification RPC v12
CREATE OR REPLACE FUNCTION public.complete_channel_verification_v12(
  p_workspace_id UUID,
  p_channel TEXT,
  p_action_request_id UUID,
  p_verification_code TEXT,
  p_external_post_id TEXT,
  p_permalink TEXT,
  p_actor_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request_count INT;
  v_attempt_count INT;
  v_receipt_count INT;
BEGIN
  -- 1. Action Request MUST exist and belong to workspace and channel
  IF p_action_request_id IS NULL THEN
    RAISE EXCEPTION 'ACTION_REQUEST_ID_REQUIRED';
  END IF;

  SELECT count(*) INTO v_request_count
  FROM public.external_action_requests
  WHERE id = p_action_request_id
    AND workspace_id = p_workspace_id
    AND channel = p_channel;

  IF v_request_count = 0 THEN
    RAISE EXCEPTION 'CANONICAL_ACTION_REQUEST_NOT_FOUND: action_request_id % does not exist for workspace % and channel %',
      p_action_request_id, p_workspace_id, p_channel;
  END IF;

  -- 2. External Action Attempt MUST exist
  SELECT count(*) INTO v_attempt_count
  FROM public.external_action_attempts
  WHERE action_request_id = p_action_request_id
    AND workspace_id = p_workspace_id;

  IF v_attempt_count = 0 THEN
    RAISE EXCEPTION 'CANONICAL_ACTION_ATTEMPT_NOT_FOUND: no attempt recorded for action_request_id %',
      p_action_request_id;
  END IF;

  -- 3. Observed result receipt MUST exist
  SELECT count(*) INTO v_receipt_count
  FROM public.external_action_receipts
  WHERE action_request_id = p_action_request_id
    AND workspace_id = p_workspace_id
    AND receipt_kind = 'observed_result';

  IF v_receipt_count = 0 THEN
    RAISE EXCEPTION 'OBSERVED_RESULT_RECEIPT_NOT_FOUND: no observed_result receipt recorded for action_request_id %',
      p_action_request_id;
  END IF;

  -- 4. Evidence verification passed: record VERIFIED run
  INSERT INTO public.channel_verification_runs (
    workspace_id,
    channel,
    verification_code,
    status,
    action_request_id,
    external_post_id,
    external_permalink,
    read_after_write_at,
    verified_by,
    created_at
  ) VALUES (
    p_workspace_id,
    p_channel,
    p_verification_code,
    'VERIFIED',
    p_action_request_id,
    p_external_post_id,
    p_permalink,
    NOW(),
    p_actor_user_id,
    NOW()
  );

  -- 5. Promote channel connection to connected
  UPDATE public.channel_connections
  SET status = 'connected',
      updated_at = NOW()
  WHERE workspace_id = p_workspace_id AND channel = p_channel;

  RETURN TRUE;
END;
$$;

-- 3. Backward Compatibility: v11 delegates to v12 to prevent orphan bypass
CREATE OR REPLACE FUNCTION public.complete_channel_verification_v11(
  p_workspace_id UUID,
  p_channel TEXT,
  p_action_request_id UUID,
  p_verification_code TEXT,
  p_external_post_id TEXT,
  p_permalink TEXT,
  p_actor_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.complete_channel_verification_v12(
    p_workspace_id,
    p_channel,
    p_action_request_id,
    p_verification_code,
    p_external_post_id,
    p_permalink,
    p_actor_user_id
  );
END;
$$;
