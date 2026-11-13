-- Mission contract hardening (ANI-1796/1801/1802/1877).
-- New migration in this branch; never replace an already-applied revision.
-- If this version has been applied elsewhere, ship the correction as a later migration.
ALTER TABLE public.external_action_requests ADD COLUMN IF NOT EXISTS mission_id uuid;
ALTER TABLE public.external_action_requests
  ADD CONSTRAINT external_action_requests_workspace_mission_fkey
  FOREIGN KEY (workspace_id, mission_id)
  REFERENCES public.marketing_missions (workspace_id, id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_external_action_requests_workspace_mission
  ON public.external_action_requests (workspace_id, mission_id) WHERE mission_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mission_action_receipts_workspace_receipt_unique
  ON public.mission_action_receipts (workspace_id, action_receipt_id);

CREATE OR REPLACE FUNCTION public.update_mission_snapshot_atomic(
  p_workspace_id uuid,
  p_mission_id uuid,
  p_expected_snapshot_version integer,
  p_new_metadata jsonb,
  p_new_status text DEFAULT NULL,
  p_new_goal text DEFAULT NULL,
  p_new_receipt_id uuid DEFAULT NULL,
  p_actor_type text DEFAULT 'agent',
  p_actor_id text DEFAULT NULL,
  p_event_name text DEFAULT 'MISSION_SNAPSHOT_UPDATED',
  p_event_payload jsonb DEFAULT '{}'::jsonb,
  p_receipt_entry jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mission public.marketing_missions%ROWTYPE;
  v_version integer;
  v_from_status text;
  v_now timestamptz := now();
  v_metadata jsonb;
  v_receipt_id uuid;
  v_request_id uuid;
  v_receipt public.external_action_receipts%ROWTYPE;
  v_request public.external_action_requests%ROWTYPE;
  v_is_verified boolean := false;
  v_verified_at timestamptz;
  v_current_exec text;
  v_target_exec text;
  v_current_outcome text;
  v_target_outcome text;
  v_contract_reset boolean := false;
BEGIN
  IF p_expected_snapshot_version IS NULL OR p_expected_snapshot_version < 1 THEN
    RAISE EXCEPTION '[INVALID_SNAPSHOT_VERSION]' USING ERRCODE = '22023';
  END IF;
  IF p_new_metadata IS NULL OR jsonb_typeof(p_new_metadata) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '[INVALID_METADATA]' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_mission FROM public.marketing_missions
    WHERE id = p_mission_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[MISSION_NOT_FOUND]' USING ERRCODE = 'P0002';
  END IF;
  v_version := COALESCE((v_mission.metadata->>'snapshot_version')::integer, 1);
  IF v_version <> p_expected_snapshot_version THEN
    RAISE EXCEPTION '[STALE_SNAPSHOT_VERSION]' USING ERRCODE = 'P0004';
  END IF;
  v_from_status := v_mission.status;

  -- Validate BOTH receipt inputs through the same authoritative ledger path.
  -- A pointer-only update must not bypass tenant/request/mission binding checks.
  v_receipt_id := COALESCE((p_receipt_entry->>'receipt_id')::uuid, p_new_receipt_id);
  IF p_receipt_entry IS NOT NULL AND (jsonb_typeof(p_receipt_entry) IS DISTINCT FROM 'object'
      OR p_receipt_entry->>'receipt_id' IS NULL
      OR NULLIF(trim(p_receipt_entry->>'action_fingerprint'), '') IS NULL) THEN
    RAISE EXCEPTION '[INVALID_RECEIPT]' USING ERRCODE = '22023';
  END IF;
  IF p_new_receipt_id IS NOT NULL AND p_new_receipt_id IS DISTINCT FROM v_receipt_id THEN
    RAISE EXCEPTION '[RECEIPT_POINTER_MISMATCH]' USING ERRCODE = '22023';
  END IF;
  IF v_receipt_id IS NOT NULL THEN
    SELECT * INTO v_receipt FROM public.external_action_receipts
      WHERE id = v_receipt_id AND workspace_id = p_workspace_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '[RECEIPT_NOT_FOUND]' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (SELECT 1 FROM public.mission_action_receipts
        WHERE workspace_id = p_workspace_id AND action_receipt_id = v_receipt_id
          AND mission_id <> p_mission_id) THEN
      RAISE EXCEPTION '[CROSS_MISSION_RECEIPT_BLOCKED]' USING ERRCODE = '23505';
    END IF;
    v_request_id := v_receipt.action_request_id;
    IF p_receipt_entry->>'action_request_id' IS NOT NULL
        AND (p_receipt_entry->>'action_request_id')::uuid IS DISTINCT FROM v_request_id THEN
      RAISE EXCEPTION '[REQUEST_MISMATCH]' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_request FROM public.external_action_requests
      WHERE id = v_request_id AND workspace_id = p_workspace_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '[REQUEST_NOT_FOUND]' USING ERRCODE = 'P0002';
    END IF;
    IF (v_request.exact_payload ? 'mission_id'
          AND (v_request.exact_payload->>'mission_id')::uuid IS DISTINCT FROM p_mission_id)
        OR (v_request.exact_payload ? 'missionId'
          AND (v_request.exact_payload->>'missionId')::uuid IS DISTINCT FROM p_mission_id)
        OR (v_request.mission_id IS NOT NULL AND v_request.mission_id <> p_mission_id) THEN
      RAISE EXCEPTION '[CROSS_MISSION_REQUEST_BLOCKED]' USING ERRCODE = '22023';
    END IF;
    IF v_request.mission_id IS NULL THEN
      IF NOT COALESCE((v_request.exact_payload->>'mission_id')::uuid = p_mission_id
          OR (v_request.exact_payload->>'missionId')::uuid = p_mission_id
          OR v_mission.external_action_request_id = v_request_id, false) THEN
        RAISE EXCEPTION '[MISSION_ACTION_BINDING_REQUIRED]' USING ERRCODE = '22023';
      END IF;
      UPDATE public.external_action_requests SET mission_id = p_mission_id
        WHERE id = v_request_id AND workspace_id = p_workspace_id AND mission_id IS NULL;
    END IF;

    IF v_receipt.receipt_kind = 'observed_result' THEN
      v_is_verified := COALESCE(
        NOT (COALESCE(v_receipt.observed_payload->'verified' = 'false'::jsonb, false)
          OR COALESCE(v_receipt.observed_payload->'readbackVerified' = 'false'::jsonb, false))
        AND (COALESCE(v_receipt.observed_payload->'verified' = 'true'::jsonb, false)
          OR COALESCE(v_receipt.observed_payload->'readbackVerified' = 'true'::jsonb, false)
          OR (jsonb_typeof(v_receipt.observed_payload->'readbackRequestId') = 'string'
            AND length(trim(v_receipt.observed_payload->>'readbackRequestId')) > 0)
          OR (jsonb_typeof(v_receipt.observed_payload->'readbackDigest') = 'string'
            AND length(trim(v_receipt.observed_payload->>'readbackDigest')) > 0)), false);
    ELSE
      -- Explicit VERIFIED is required; a legacy timestamp alone proves nothing.
      v_is_verified := COALESCE(v_receipt.receipt_kind NOT IN ('submission', 'provider_review'), true)
        AND v_receipt.status = 'VERIFIED' AND v_receipt.verified_at IS NOT NULL;
    END IF;
    IF v_is_verified THEN
      v_verified_at := COALESCE(v_receipt.verified_at,
        (v_receipt.observed_payload->>'verified_at')::timestamptz,
        (v_receipt.observed_payload->>'observedAt')::timestamptz,
        v_receipt.recorded_at, v_receipt.created_at, v_now);
    END IF;
    IF p_receipt_entry IS NOT NULL THEN
      INSERT INTO public.mission_action_receipts (
        workspace_id, mission_id, action_request_id, action_receipt_id,
        action_fingerprint, provider, cost_minor_units, verified_at
      ) VALUES (p_workspace_id, p_mission_id, v_request_id, v_receipt_id,
        p_receipt_entry->>'action_fingerprint', COALESCE(p_receipt_entry->>'provider', 'unknown'),
        COALESCE((p_receipt_entry->>'cost_minor_units')::bigint, 0), v_verified_at);
      IF jsonb_typeof(p_new_metadata->'multi_receipts') = 'array' THEN
        SELECT jsonb_set(p_new_metadata, '{multi_receipts}', COALESCE(jsonb_agg(
          CASE WHEN COALESCE(elem->>'receipt_id', elem->>'receiptId') = v_receipt_id::text
            THEN elem || jsonb_build_object('actionRequestId', v_request_id,
              'action_request_id', v_request_id, 'verifiedAt', v_verified_at, 'verified_at', v_verified_at)
            ELSE elem END), '[]'::jsonb)) INTO p_new_metadata
          FROM jsonb_array_elements(p_new_metadata->'multi_receipts') AS elem;
      END IF;
      -- Late readback must never restart a paused/stopped/closed mission.
      v_current_exec := COALESCE(v_mission.metadata->>'execution_state', 'DRAFT');
      v_target_exec := p_new_metadata->>'execution_state';
      IF v_current_exec IN ('PAUSING', 'PAUSED', 'STOPPED', 'CLOSED') THEN
        p_new_metadata := p_new_metadata || jsonb_build_object('execution_state', v_current_exec);
        p_new_status := v_mission.status;
      ELSIF v_is_verified AND COALESCE(v_target_exec, '') NOT IN ('PAUSING', 'PAUSED', 'STOPPED', 'CLOSED') THEN
        p_new_metadata := p_new_metadata || '{"execution_state":"OBSERVING"}'::jsonb;
      ELSIF NOT v_is_verified AND COALESCE(v_target_exec, v_current_exec) = 'OBSERVING' THEN
        p_new_metadata := p_new_metadata || '{"execution_state":"WAITING_EXTERNAL"}'::jsonb;
      END IF;
    END IF;
  END IF;

  -- Invariants apply to every update, not just receipt-entry calls.
  v_metadata := COALESCE(v_mission.metadata, '{}'::jsonb) || p_new_metadata;
  IF v_metadata ? 'control_epoch' THEN
    IF jsonb_typeof(v_metadata->'control_epoch') IS DISTINCT FROM 'number'
        OR (v_metadata->>'control_epoch') !~ '^[0-9]+$'
        OR (v_metadata->>'control_epoch')::numeric > 9007199254740991
        OR (v_metadata->>'control_epoch')::numeric < COALESCE((v_mission.metadata->>'control_epoch')::numeric, 0) THEN
      RAISE EXCEPTION '[CONTROL_EPOCH_REGRESSION]' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_mission.status IN ('COMPLETED', 'CANCELLED')
      AND COALESCE(p_new_status, v_mission.status) IS DISTINCT FROM v_mission.status THEN
    RAISE EXCEPTION '[TERMINAL_STATUS_REGRESSION]' USING ERRCODE = '22023';
  END IF;
  v_current_exec := v_mission.metadata->>'execution_state';
  v_target_exec := v_metadata->>'execution_state';
  IF (v_current_exec = 'CLOSED' AND v_target_exec IS DISTINCT FROM 'CLOSED')
      OR (v_current_exec = 'STOPPED' AND (v_target_exec IS NULL OR v_target_exec NOT IN ('STOPPED', 'CLOSED')))
      OR (v_current_exec = 'PAUSING' AND (v_target_exec IS NULL OR v_target_exec NOT IN ('PAUSING', 'PAUSED', 'STOPPED')))
      OR (v_current_exec = 'PAUSED' AND (v_target_exec IS NULL OR v_target_exec NOT IN ('PAUSED', 'READY', 'RUNNING', 'STOPPED', 'CLOSED')))
      OR (v_mission.status IN ('COMPLETED', 'CANCELLED')
        AND v_target_exec IS DISTINCT FROM v_current_exec
        AND NOT (v_mission.status = 'CANCELLED' AND v_current_exec = 'STOPPED' AND v_target_exec = 'CLOSED')) THEN
    RAISE EXCEPTION '[CONTROL_STATE_REGRESSION]' USING ERRCODE = '22023';
  END IF;
  v_current_outcome := COALESCE(v_mission.metadata->>'outcome_state', 'PENDING');
  v_target_outcome := COALESCE(v_metadata->>'outcome_state', 'PENDING');
  -- A genuinely new unapproved contract resets observations on a nonclosed mission.
  -- Event names alone are not authority to erase a terminal outcome.
  v_contract_reset := COALESCE(v_mission.status NOT IN ('COMPLETED', 'CANCELLED')
    AND COALESCE(v_current_exec, '') NOT IN ('STOPPED', 'CLOSED')
    AND (v_metadata#>>'{contract,contract_version}')::integer > (v_mission.metadata#>>'{contract,contract_version}')::integer
    AND v_target_outcome = 'PENDING'
    AND v_metadata->'observation_evidence' = 'null'::jsonb
    AND v_metadata#>'{contract,approval_fingerprint}' = 'null'::jsonb, false);
  IF v_current_outcome IS DISTINCT FROM v_target_outcome AND NOT v_contract_reset THEN
    IF NOT (CASE v_current_outcome
      WHEN 'PENDING' THEN v_target_outcome IN ('ACHIEVED_VERIFIED', 'NOT_ACHIEVED_IN_WINDOW', 'NOT_OBSERVABLE', 'WITHDRAWN')
      WHEN 'NOT_ACHIEVED_IN_WINDOW' THEN v_target_outcome = 'ACHIEVED_VERIFIED'
      WHEN 'NOT_OBSERVABLE' THEN v_target_outcome IN ('PENDING', 'ACHIEVED_VERIFIED', 'NOT_ACHIEVED_IN_WINDOW')
      ELSE false END) THEN
      RAISE EXCEPTION '[INVALID_OUTCOME_TRANSITION]' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_metadata := v_metadata || jsonb_build_object('snapshot_version', v_version + 1);
  UPDATE public.marketing_missions SET
    status = COALESCE(p_new_status, status), goal = COALESCE(p_new_goal, goal),
    external_action_receipt_id = COALESCE(p_new_receipt_id, external_action_receipt_id),
    metadata = v_metadata, updated_at = v_now
    WHERE id = p_mission_id AND workspace_id = p_workspace_id RETURNING * INTO v_mission;
  INSERT INTO public.mission_events (workspace_id, mission_id, trace_id, from_status,
    to_status, actor_type, actor_id, event_name, payload, occurred_at)
    VALUES (p_workspace_id, p_mission_id, v_mission.trace_id, v_from_status,
      v_mission.status, p_actor_type, p_actor_id, p_event_name,
      COALESCE(p_event_payload, '{}'::jsonb) || jsonb_build_object('applied_snapshot_version', v_version + 1), v_now);
  RETURN to_jsonb(v_mission);
END;
$$;
REVOKE ALL ON FUNCTION public.update_mission_snapshot_atomic FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_mission_snapshot_atomic TO service_role;

CREATE OR REPLACE FUNCTION public.create_mission_with_contract_atomic(
  p_workspace_id uuid,
  p_trace_id text,
  p_status text,
  p_goal text,
  p_strategy_summary text DEFAULT NULL,
  p_target_channel text DEFAULT NULL,
  p_target_audience text DEFAULT NULL,
  p_source_message_id text DEFAULT NULL,
  p_source_conversation_job_id text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_actor_type text DEFAULT 'user',
  p_actor_id text DEFAULT NULL,
  p_event_name text DEFAULT 'MISSION_CONTRACT_INITIALIZED',
  p_event_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mission public.marketing_missions%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION '[INVALID_WORKSPACE]' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(trim(p_trace_id), '') IS NULL THEN
    RAISE EXCEPTION '[INVALID_TRACE]' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.marketing_missions (workspace_id, trace_id, status, goal,
    strategy_summary, target_channel, target_audience, source_message_id,
    source_conversation_job_id, metadata, created_at, updated_at)
    VALUES (p_workspace_id, p_trace_id, p_status, p_goal, p_strategy_summary,
      p_target_channel, p_target_audience, NULLIF(trim(p_source_message_id), '')::uuid,
      NULLIF(trim(p_source_conversation_job_id), '')::uuid, COALESCE(p_metadata, '{}'::jsonb), v_now, v_now)
    RETURNING * INTO v_mission;
  INSERT INTO public.mission_events (workspace_id, mission_id, trace_id, from_status,
    to_status, actor_type, actor_id, event_name, payload, occurred_at)
    VALUES (p_workspace_id, v_mission.id, p_trace_id, NULL, p_status, p_actor_type,
      p_actor_id, p_event_name, p_event_payload, v_now);
  RETURN to_jsonb(v_mission);
END;
$$;
REVOKE ALL ON FUNCTION public.create_mission_with_contract_atomic FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_mission_with_contract_atomic TO service_role;
