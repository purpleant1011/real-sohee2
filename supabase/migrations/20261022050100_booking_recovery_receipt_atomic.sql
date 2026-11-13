-- ANI-1611 / ANI-1608: Customer Acceptance Receipt & Latest Message Atomic Linearization Gate
-- Forward-only; no operational database is modified by adding this file.

-- 1. Helper function in private schema for acceptance evidence validation.
-- Private helper; revoked from PUBLIC, anon, authenticated.
CREATE OR REPLACE FUNCTION private.validate_booking_recovery_acceptance_evidence(
  p_workspace_id uuid,
  p_case_id uuid,
  p_customer_ref text,
  p_source_thread_id uuid,
  p_inbound_message_id uuid,
  p_accepted_proposal_fingerprint text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_msg record;
  v_latest_customer_msg_id uuid;
  v_normalized_text text;
  v_step record;
  v_evidence_json jsonb;
  v_expected_sender_id text;
  v_requested_at timestamptz;
  v_observed_at timestamptz;
  v_req_str text;
  v_obs_str text;
BEGIN
  -- 1. Look up inbound acceptance message
  SELECT * INTO v_msg
  FROM public.instagram_dm_messages
  WHERE workspace_id = p_workspace_id
    AND id = p_inbound_message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Acceptance message not found in workspace'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_msg.sender_type != 'customer' THEN
    RAISE EXCEPTION 'INVALID_ACCEPTANCE: Acceptance message sender_type must be customer'
      USING ERRCODE = '22000';
  END IF;

  IF v_msg.sender_id != p_customer_ref THEN
    RAISE EXCEPTION 'INVALID_ACCEPTANCE: Customer ref mismatch between case and acceptance message'
      USING ERRCODE = '22000';
  END IF;

  IF v_msg.thread_id != p_source_thread_id THEN
    RAISE EXCEPTION 'INVALID_ACCEPTANCE: Thread mismatch between case and acceptance message'
      USING ERRCODE = '22000';
  END IF;

  IF v_msg.sent_at > statement_timestamp() THEN
    RAISE EXCEPTION 'INVALID_ACCEPTANCE: Acceptance message sent_at is in the future'
      USING ERRCODE = '22000';
  END IF;

  -- 2. Assert no newer customer messages exist in the same thread (linearization)
  SELECT id INTO v_latest_customer_msg_id
  FROM public.instagram_dm_messages
  WHERE workspace_id = p_workspace_id
    AND thread_id = p_source_thread_id
    AND sender_type = 'customer'
    AND sender_id = p_customer_ref
  ORDER BY sent_at DESC, created_at DESC, id DESC
  LIMIT 1;

  IF v_latest_customer_msg_id IS DISTINCT FROM p_inbound_message_id THEN
    RAISE EXCEPTION 'ACCEPTANCE_SUPERSEDED: Customer sent newer message since acceptance message'
      USING ERRCODE = '40001';
  END IF;

  -- 3. Assert unambiguous acceptance wording of unchanged terms
  -- Service acceptsUnchangedTerms parity: NFKC normalization + stripping whitespace and approved punctuation only.
  -- Question marks (? and ？) are strictly preserved to reject question-form inquiries.
  v_normalized_text := regexp_replace(normalize(v_msg.text, NFKC), '[\s,.!，。！]', '', 'g');
  IF v_normalized_text !~ '^((네)?(그|해당)(시간|조건)(으로|에)(예약(진행)?(해주세요|할게요)|확정(해주세요|할게요)))$' THEN
    RAISE EXCEPTION 'AMBIGUOUS_ACCEPTANCE: Acceptance wording does not unambiguously accept unchanged offered terms'
      USING ERRCODE = '22000';
  END IF;

  -- 4. Look up verified delivery step
  SELECT * INTO v_step
  FROM public.booking_recovery_steps
  WHERE workspace_id = p_workspace_id
    AND case_id = p_case_id
    AND kind IN ('SEND_DM_VERIFIED', 'RECONCILE_VERIFIED')
    AND status = 'COMPLETED'
    AND input_fingerprint = p_accepted_proposal_fingerprint
    AND provider_message_id IS NOT NULL AND length(trim(provider_message_id)) > 0
    AND actor_id IS NOT NULL AND length(trim(actor_id)) > 0
    AND occurred_at IS NOT NULL
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VERIFIED_DELIVERY_REQUIRED: Verified DM send evidence not found for proposal fingerprint'
      USING ERRCODE = '22000';
  END IF;

  -- 5. Strict validation of evidence_ref JSON structure and attributes
  BEGIN
    v_evidence_json := v_step.evidence_ref::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE: Step evidence_ref is not valid JSON'
      USING ERRCODE = '22000';
  END;

  IF jsonb_typeof(v_evidence_json) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE: Delivery evidence must be a JSON object'
      USING ERRCODE = '22000';
  END IF;

  -- Strictly reject missing, extra, or unexpected keys (TypeScript deliveryEvidenceSchema.strict parity)
  IF (SELECT count(*) FROM jsonb_object_keys(v_evidence_json)) != 8
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(v_evidence_json) AS k
       WHERE k NOT IN (
         'schemaVersion', 'channel', 'providerMessageId', 'payloadFingerprint',
         'senderId', 'recipientRef', 'requestedAt', 'observedAt'
       )
     ) THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE: Delivery evidence keys mismatch strict contract'
      USING ERRCODE = '22000';
  END IF;

  -- Verify existence and exact types of all required fields
  IF jsonb_typeof(v_evidence_json->'schemaVersion') IS DISTINCT FROM 'number'
     OR (v_evidence_json->'schemaVersion')::text IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE: Schema version must be number 1'
      USING ERRCODE = '22000';
  END IF;

  IF jsonb_typeof(v_evidence_json->'channel') IS DISTINCT FROM 'string'
     OR v_evidence_json->>'channel' IS DISTINCT FROM 'instagram' THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE: Channel must be string instagram'
      USING ERRCODE = '22000';
  END IF;

  IF jsonb_typeof(v_evidence_json->'providerMessageId') IS DISTINCT FROM 'string'
     OR length(trim(v_evidence_json->>'providerMessageId')) = 0
     OR (v_evidence_json->>'providerMessageId') IS DISTINCT FROM v_step.provider_message_id THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE: providerMessageId mismatch between evidence and step'
      USING ERRCODE = '22000';
  END IF;

  IF jsonb_typeof(v_evidence_json->'payloadFingerprint') IS DISTINCT FROM 'string'
     OR (v_evidence_json->>'payloadFingerprint') !~ '^[a-f0-9]{64}$'
     OR (v_evidence_json->>'payloadFingerprint') IS DISTINCT FROM v_step.input_fingerprint
     OR (v_evidence_json->>'payloadFingerprint') IS DISTINCT FROM p_accepted_proposal_fingerprint THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE: payloadFingerprint mismatch between evidence and step'
      USING ERRCODE = '22000';
  END IF;

  IF jsonb_typeof(v_evidence_json->'recipientRef') IS DISTINCT FROM 'string'
     OR length(trim(v_evidence_json->>'recipientRef')) = 0
     OR (v_evidence_json->>'recipientRef') IS DISTINCT FROM p_customer_ref THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE: recipientRef mismatch between evidence and customer'
      USING ERRCODE = '22000';
  END IF;

  IF jsonb_typeof(v_evidence_json->'senderId') IS DISTINCT FROM 'string'
     OR length(trim(v_evidence_json->>'senderId')) = 0 THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE: senderId must be a non-empty string'
      USING ERRCODE = '22000';
  END IF;

  -- senderId must strictly match connected business account
  SELECT cc.external_account_id INTO v_expected_sender_id
  FROM public.instagram_dm_threads t
  JOIN public.channel_connections cc ON cc.id = t.channel_connection_id AND cc.workspace_id = t.workspace_id
  WHERE t.workspace_id = p_workspace_id AND t.id = p_source_thread_id;

  IF NOT FOUND OR v_expected_sender_id IS NULL OR length(trim(v_expected_sender_id)) = 0 THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE: Connected channel account is missing or not configured'
      USING ERRCODE = '22000';
  END IF;

  IF (v_evidence_json->>'senderId') IS DISTINCT FROM v_expected_sender_id THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE: senderId mismatch with connected business account'
      USING ERRCODE = '22000';
  END IF;

  -- Timestamp format and offset validation
  v_req_str := v_evidence_json->>'requestedAt';
  v_obs_str := v_evidence_json->>'observedAt';

  IF jsonb_typeof(v_evidence_json->'requestedAt') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_evidence_json->'observedAt') IS DISTINCT FROM 'string'
     OR v_req_str IS NULL
     OR v_obs_str IS NULL
     OR v_req_str !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
     OR v_obs_str !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE: requestedAt and observedAt must be ISO-8601 strings with timezone offset'
      USING ERRCODE = '22000';
  END IF;

  BEGIN
    v_requested_at := v_req_str::timestamptz;
    v_observed_at := v_obs_str::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE: Malformed timestamp in delivery evidence'
      USING ERRCODE = '22000';
  END;

  IF v_requested_at > v_observed_at THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE: requestedAt is after observedAt'
      USING ERRCODE = '22000';
  END IF;

  IF v_observed_at > v_step.occurred_at THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE: observedAt is after step occurred_at'
      USING ERRCODE = '22000';
  END IF;

  IF v_step.occurred_at > statement_timestamp() THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE: step occurred_at is in the future'
      USING ERRCODE = '22000';
  END IF;

  IF v_msg.sent_at <= v_observed_at THEN
    RAISE EXCEPTION 'INVALID_ACCEPTANCE: Customer acceptance sent_at is not strictly after observed delivery'
      USING ERRCODE = '22000';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_booking_recovery_acceptance_evidence(uuid, uuid, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.validate_booking_recovery_acceptance_evidence(uuid, uuid, text, uuid, uuid, text) TO service_role;


-- 2. Update transition_booking_recovery with thread locking and atomic customer acceptance.
CREATE OR REPLACE FUNCTION public.transition_booking_recovery(
  p_workspace_id uuid,
  p_case_id uuid,
  p_expected_version int,
  p_next_stage text,
  p_actor_id uuid,
  p_step_kind text,
  p_fingerprint text,
  p_idempotency_key text,
  p_provider_msg_id text DEFAULT NULL,
  p_evidence_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_thread_id uuid;
  v_thread record;
  v_case record;
  v_proposal record;
  v_updated record;
  v_is_valid_transition boolean := false;
  v_existing_outbox_case uuid;
BEGIN
  -- 1. Caller Authorization Check
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = p_workspace_id
      AND user_id = p_actor_id
      AND role IN ('owner', 'manager')
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: Caller is not an authorized manager/owner of workspace %', p_workspace_id
      USING ERRCODE = '42501';
  END IF;

  -- 2. Explicit prohibition of generic transition to BOOKING_CONFIRMED
  IF p_next_stage = 'BOOKING_CONFIRMED' THEN
    RAISE EXCEPTION 'FORBIDDEN_TRANSITION: BOOKING_CONFIRMED cannot be set via generic transition; requires confirm_booking_recovery RPC'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Lock Thread first, then Case
  SELECT source_thread_id INTO v_thread_id
  FROM public.booking_recovery_cases
  WHERE workspace_id = p_workspace_id
    AND id = p_case_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Case % not found in workspace %', p_case_id, p_workspace_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_thread
  FROM public.instagram_dm_threads
  WHERE workspace_id = p_workspace_id
    AND id = v_thread_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Thread % not found in workspace %', v_thread_id, p_workspace_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_case
  FROM public.booking_recovery_cases
  WHERE workspace_id = p_workspace_id
    AND id = p_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Case % not found in workspace %', p_case_id, p_workspace_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_case.source_thread_id IS DISTINCT FROM v_thread_id THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: Case source_thread_id changed during acquisition'
      USING ERRCODE = '40001';
  END IF;

  -- Replay idempotency: if already in next_stage with same evidence/fingerprint and next version, return existing
  IF v_case.stage = p_next_stage AND p_next_stage = 'CUSTOMER_ACCEPTED' THEN
    IF p_evidence_ref IS NOT NULL THEN
      BEGIN
        IF v_case.accepted_inbound_message_id IS NOT DISTINCT FROM p_evidence_ref::uuid THEN
          SELECT * INTO v_proposal
          FROM public.booking_recovery_proposals
          WHERE workspace_id = p_workspace_id
            AND case_id = p_case_id
          ORDER BY revision DESC
          LIMIT 1;

          IF FOUND AND v_proposal.payload_fingerprint IS NOT DISTINCT FROM p_fingerprint THEN
            IF EXISTS (
              SELECT 1 FROM public.booking_recovery_steps
              WHERE workspace_id = p_workspace_id
                AND case_id = p_case_id
                AND status = 'COMPLETED'
                AND input_fingerprint = p_fingerprint
                AND evidence_ref = p_evidence_ref
            ) AND EXISTS (
              SELECT 1 FROM public.booking_recovery_outbox
              WHERE workspace_id = p_workspace_id
                AND case_id = p_case_id
                AND kind = 'CUSTOMER_ACCEPTED'
                AND source_event_key = 'acceptance:' || (p_evidence_ref::uuid)::text
            ) THEN
              RETURN to_jsonb(v_case);
            END IF;
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
    RAISE EXCEPTION 'VERSION_CONFLICT: Customer acceptance replay parameters or bound evidence mismatch'
      USING ERRCODE = '40001';
  END IF;

  IF v_case.version != p_expected_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: Expected version % but found % for case %', p_expected_version, v_case.version, p_case_id
      USING ERRCODE = '40001';
  END IF;

  -- 4. Validate Stage Transition Matrix
  CASE v_case.stage
    WHEN 'DISCOVERED' THEN
      v_is_valid_transition := p_next_stage IN ('NEEDS_CONTEXT', 'DRAFT_READY', 'BLOCKED', 'EXPIRED', 'HUMAN_REVIEW');
    WHEN 'NEEDS_CONTEXT' THEN
      v_is_valid_transition := p_next_stage IN ('DRAFT_READY', 'BLOCKED', 'EXPIRED', 'HUMAN_REVIEW');
    WHEN 'DRAFT_READY' THEN
      v_is_valid_transition := p_next_stage IN ('AWAITING_SEND_APPROVAL', 'BLOCKED', 'EXPIRED', 'HUMAN_REVIEW');
    WHEN 'AWAITING_SEND_APPROVAL' THEN
      v_is_valid_transition := p_next_stage IN ('SEND_REQUESTED', 'DRAFT_READY', 'BLOCKED', 'EXPIRED', 'HUMAN_REVIEW');
    WHEN 'SEND_REQUESTED' THEN
      v_is_valid_transition := p_next_stage IN ('PROVIDER_ACCEPTED', 'SEND_VERIFIED', 'RESULT_UNKNOWN', 'BLOCKED', 'HUMAN_REVIEW');
    WHEN 'PROVIDER_ACCEPTED' THEN
      v_is_valid_transition := p_next_stage IN ('SEND_VERIFIED', 'RESULT_UNKNOWN', 'BLOCKED', 'HUMAN_REVIEW');
    WHEN 'SEND_VERIFIED' THEN
      v_is_valid_transition := p_next_stage IN ('AWAITING_CUSTOMER', 'BLOCKED', 'EXPIRED', 'HUMAN_REVIEW');
    WHEN 'AWAITING_CUSTOMER' THEN
      v_is_valid_transition := p_next_stage IN ('CUSTOMER_ACCEPTED', 'DECLINED', 'EXPIRED', 'HUMAN_REVIEW');
    WHEN 'CUSTOMER_ACCEPTED' THEN
      v_is_valid_transition := p_next_stage IN ('AWAITING_BOOKING_APPROVAL', 'BLOCKED', 'EXPIRED', 'HUMAN_REVIEW');
    WHEN 'AWAITING_BOOKING_APPROVAL' THEN
      v_is_valid_transition := p_next_stage IN ('BLOCKED', 'EXPIRED', 'HUMAN_REVIEW');
    WHEN 'RESULT_UNKNOWN' THEN
      v_is_valid_transition := p_next_stage IN ('NEEDS_RECONCILIATION', 'HUMAN_REVIEW');
    WHEN 'NEEDS_RECONCILIATION' THEN
      v_is_valid_transition := p_next_stage IN ('SEND_VERIFIED', 'RESULT_UNKNOWN', 'HUMAN_REVIEW');
    WHEN 'HUMAN_REVIEW' THEN
      v_is_valid_transition := p_next_stage IN ('DRAFT_READY', 'AWAITING_SEND_APPROVAL', 'AWAITING_CUSTOMER', 'AWAITING_BOOKING_APPROVAL', 'BLOCKED', 'DECLINED', 'EXPIRED');
    ELSE
      v_is_valid_transition := false;
  END CASE;

  IF NOT v_is_valid_transition THEN
    RAISE EXCEPTION 'INVALID_STAGE_TRANSITION: Cannot transition case % from % to %', p_case_id, v_case.stage, p_next_stage
      USING ERRCODE = '22000';
  END IF;

  -- 5. Evidence & Fingerprint Guards
  IF p_next_stage IN ('AWAITING_SEND_APPROVAL', 'SEND_REQUESTED') THEN
    IF p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'INVALID_FINGERPRINT: A valid 64-character hex fingerprint is required for stage %', p_next_stage
        USING ERRCODE = '22000';
    END IF;
  END IF;

  IF p_next_stage IN ('PROVIDER_ACCEPTED', 'SEND_VERIFIED') THEN
    IF p_provider_msg_id IS NULL OR length(trim(p_provider_msg_id)) = 0 THEN
      RAISE EXCEPTION 'EVIDENCE_REQUIRED: provider_message_id is required for stage %', p_next_stage
        USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 6. CUSTOMER_ACCEPTED atomic verification & outbox commit
  IF p_next_stage = 'CUSTOMER_ACCEPTED' THEN
    IF p_evidence_ref IS NULL THEN
      RAISE EXCEPTION 'EVIDENCE_REQUIRED: Inbound message UUID is required for CUSTOMER_ACCEPTED stage'
        USING ERRCODE = '22000';
    END IF;

    SELECT * INTO v_proposal
    FROM public.booking_recovery_proposals
    WHERE workspace_id = p_workspace_id
      AND case_id = p_case_id
    ORDER BY revision DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_FOUND: No active proposal found for case %', p_case_id
        USING ERRCODE = 'P0002';
    END IF;

    IF v_proposal.payload_fingerprint IS DISTINCT FROM p_fingerprint THEN
      RAISE EXCEPTION 'FINGERPRINT_MISMATCH: Current proposal fingerprint differs from transition request'
        USING ERRCODE = '40001';
    END IF;

    PERFORM private.validate_booking_recovery_acceptance_evidence(
      p_workspace_id,
      p_case_id,
      v_case.customer_ref,
      v_case.source_thread_id,
      p_evidence_ref::uuid,
      v_proposal.payload_fingerprint
    );

    -- Enqueue Outbox in same transaction
    SELECT case_id INTO v_existing_outbox_case
    FROM public.booking_recovery_outbox
    WHERE workspace_id = p_workspace_id
      AND source_event_key = 'acceptance:' || (p_evidence_ref::uuid)::text
      AND kind = 'CUSTOMER_ACCEPTED';

    IF FOUND THEN
      IF v_existing_outbox_case != p_case_id THEN
        RAISE EXCEPTION 'OUTBOX_CONFLICT: source_event_key already bound to another case %', v_existing_outbox_case
          USING ERRCODE = '40001';
      END IF;
    ELSE
      INSERT INTO public.booking_recovery_outbox (
        workspace_id,
        case_id,
        source_event_key,
        kind,
        state,
        attempt,
        next_attempt_at
      ) VALUES (
        p_workspace_id,
        p_case_id,
        'acceptance:' || (p_evidence_ref::uuid)::text,
        'CUSTOMER_ACCEPTED',
        'PENDING',
        0,
        statement_timestamp()
      );
    END IF;
  END IF;

  -- 7. Update Case Stage, Version, and Accepted Inbound Message ID
  UPDATE public.booking_recovery_cases
  SET stage = p_next_stage,
      version = v_case.version + 1,
      accepted_inbound_message_id = CASE
        WHEN p_next_stage = 'CUSTOMER_ACCEPTED' AND p_evidence_ref IS NOT NULL
        THEN p_evidence_ref::uuid
        ELSE accepted_inbound_message_id
      END,
      updated_at = now()
  WHERE id = p_case_id
  RETURNING * INTO v_updated;

  -- 8. Record Audit Step
  INSERT INTO public.booking_recovery_steps (
    workspace_id,
    case_id,
    kind,
    status,
    input_fingerprint,
    idempotency_key,
    attempt,
    actor_id,
    provider_message_id,
    evidence_ref
  ) VALUES (
    p_workspace_id,
    p_case_id,
    p_step_kind,
    'COMPLETED',
    p_fingerprint,
    p_idempotency_key,
    1,
    p_actor_id::text,
    p_provider_msg_id,
    p_evidence_ref
  );

  RETURN to_jsonb(v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.transition_booking_recovery(uuid, uuid, int, text, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_booking_recovery(uuid, uuid, int, text, uuid, text, text, text, text, text) TO service_role;


-- 3. Update confirm_booking_recovery with linear thread locking and receipt verification.
CREATE OR REPLACE FUNCTION public.confirm_booking_recovery(
  p_workspace_id uuid,
  p_case_id uuid,
  p_expected_version int,
  p_proposal_revision int,
  p_actor_id uuid,
  p_inbound_acceptance_message_id uuid,
  p_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_thread_id uuid;
  v_thread record;
  v_case record;
  v_proposal record;
  v_accepted_proposal record;
  v_catalog record;
  v_slot record;
  v_approval record;
  v_acceptance_sent_at timestamptz;
  v_latest_revision int;
  v_replay_slot_id uuid;
  v_mission record;
  v_reservation_id text;
  v_updated_case record;
BEGIN
  -- 1. Caller Authorization Check (Workspace Member with manager/owner role and active status)
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = p_workspace_id
      AND user_id = p_actor_id
      AND role IN ('owner', 'manager')
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: Caller is not an authorized manager/owner of workspace %', p_workspace_id
      USING ERRCODE = '42501';
  END IF;

  -- 2. Lock Thread first to linearize incoming customer messages
  SELECT source_thread_id INTO v_thread_id
  FROM public.booking_recovery_cases
  WHERE workspace_id = p_workspace_id
    AND id = p_case_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Case % not found in workspace %', p_case_id, p_workspace_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_thread
  FROM public.instagram_dm_threads
  WHERE workspace_id = p_workspace_id
    AND id = v_thread_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Thread % not found in workspace %', v_thread_id, p_workspace_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Lock & Validate Case
  SELECT * INTO v_case
  FROM public.booking_recovery_cases
  WHERE workspace_id = p_workspace_id
    AND id = p_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Case % not found in workspace %', p_case_id, p_workspace_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_case.source_thread_id IS DISTINCT FROM v_thread_id THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: Case source_thread_id changed during lock acquisition'
      USING ERRCODE = '40001';
  END IF;

  -- 4. Idempotent Replay Check: If already confirmed with same proposal, return existing booking
  IF v_case.stage = 'BOOKING_CONFIRMED' THEN
    IF v_case.accepted_inbound_message_id IS DISTINCT FROM p_inbound_acceptance_message_id THEN
      RAISE EXCEPTION 'REPLAY_EVIDENCE_MISMATCH: Customer acceptance differs from committed booking'
        USING ERRCODE = '40001';
    END IF;

    SELECT id INTO v_reservation_id
    FROM public.reservations
    WHERE workspace_id = p_workspace_id
      AND (metadata->>'caseId') = p_case_id::text
      AND (metadata->>'proposalRevision') = p_proposal_revision::text
      AND proof_id = p_inbound_acceptance_message_id::text
      AND evidence_id = p_fingerprint
      AND status = 'CONFIRMED';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'REPLAY_EVIDENCE_MISMATCH: Exact confirmed reservation proof not found'
        USING ERRCODE = '40001';
    END IF;

    SELECT slot_id INTO v_replay_slot_id
    FROM public.booking_recovery_proposals
    WHERE workspace_id = p_workspace_id
      AND case_id = p_case_id
      AND revision = p_proposal_revision;

    RETURN jsonb_build_object(
      'case', to_jsonb(v_case),
      'reservation_id', v_reservation_id,
      'slot_id', v_replay_slot_id,
      'confirmed_at', v_case.updated_at
    );
  END IF;

  -- 5. Version and Stage Validation
  IF v_case.version != p_expected_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: Expected case version % but found %', p_expected_version, v_case.version
      USING ERRCODE = '40001';
  END IF;

  IF v_case.stage NOT IN ('CUSTOMER_ACCEPTED', 'AWAITING_BOOKING_APPROVAL') THEN
    RAISE EXCEPTION 'INVALID_STAGE: Case % is in stage %, cannot confirm booking', p_case_id, v_case.stage
      USING ERRCODE = '22000';
  END IF;

  -- Exact binding of p_inbound_acceptance_message_id to case.accepted_inbound_message_id (no null fallback)
  IF p_inbound_acceptance_message_id IS NULL
     OR v_case.accepted_inbound_message_id IS NULL
     OR v_case.accepted_inbound_message_id IS DISTINCT FROM p_inbound_acceptance_message_id THEN
    RAISE EXCEPTION 'ACCEPTANCE_BINDING_MISMATCH: Inbound message differs from case accepted_inbound_message_id'
      USING ERRCODE = '40001';
  END IF;

  -- 6. Lock & Validate Proposal Snapshot
  SELECT * INTO v_proposal
  FROM public.booking_recovery_proposals
  WHERE workspace_id = p_workspace_id
    AND case_id = p_case_id
    AND revision = p_proposal_revision
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Proposal revision % not found for case %', p_proposal_revision, p_case_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT revision INTO v_latest_revision
  FROM public.booking_recovery_proposals
  WHERE workspace_id = p_workspace_id
    AND case_id = p_case_id
  ORDER BY revision DESC
  LIMIT 1;

  IF v_latest_revision != p_proposal_revision THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: Latest proposal revision is % but expected %', v_latest_revision, p_proposal_revision
      USING ERRCODE = '40001';
  END IF;

  -- 7. Look up acceptance message and strictly verify acceptance snapshot
  SELECT sent_at INTO v_acceptance_sent_at
  FROM public.instagram_dm_messages
  WHERE workspace_id = p_workspace_id
    AND id = p_inbound_acceptance_message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Acceptance message not found in workspace'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_accepted_proposal
  FROM public.booking_recovery_proposals
  WHERE workspace_id = p_workspace_id
    AND case_id = p_case_id
    AND created_at <= v_acceptance_sent_at
  ORDER BY revision DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_ACCEPTANCE: Acceptance message sent_at is earlier than initial proposal creation'
      USING ERRCODE = '22000';
  END IF;

  -- Terms Invariance Check: Core offer terms (slot, service, price, deposit, times, timezone, catalog) cannot have changed
  IF v_proposal.slot_id IS DISTINCT FROM v_accepted_proposal.slot_id
     OR v_proposal.service_id IS DISTINCT FROM v_accepted_proposal.service_id
     OR v_proposal.total_amount_krw IS DISTINCT FROM v_accepted_proposal.total_amount_krw
     OR v_proposal.deposit_krw IS DISTINCT FROM v_accepted_proposal.deposit_krw
     OR v_proposal.starts_at IS DISTINCT FROM v_accepted_proposal.starts_at
     OR v_proposal.ends_at IS DISTINCT FROM v_accepted_proposal.ends_at
     OR v_proposal.timezone IS DISTINCT FROM v_accepted_proposal.timezone
     OR v_proposal.catalog_version IS DISTINCT FROM v_accepted_proposal.catalog_version THEN
    RAISE EXCEPTION 'PROPOSAL_TERMS_CHANGED: Proposal terms changed between customer acceptance and confirmation'
      USING ERRCODE = '22000';
  END IF;

  -- Re-validate customer acceptance delivery evidence and latest message
  PERFORM private.validate_booking_recovery_acceptance_evidence(
    p_workspace_id,
    p_case_id,
    v_case.customer_ref,
    v_case.source_thread_id,
    p_inbound_acceptance_message_id,
    v_accepted_proposal.payload_fingerprint
  );

  -- 8. Lock & Validate Catalog Service (Active & Price Unchanged)
  SELECT * INTO v_catalog
  FROM public.workspace_products_services
  WHERE workspace_id = p_workspace_id
    AND id = v_proposal.service_id
  FOR UPDATE;

  IF NOT FOUND OR NOT v_catalog.active OR v_catalog.price IS NULL THEN
    RAISE EXCEPTION 'CATALOG_NOT_AVAILABLE: Service catalog is inactive or unavailable'
      USING ERRCODE = '40001';
  END IF;

  IF v_catalog.price != v_proposal.total_amount_krw THEN
    RAISE EXCEPTION 'CATALOG_PRICE_CHANGED: Catalog price changed from proposal'
      USING ERRCODE = '40001';
  END IF;

  -- 9. Lock & Validate Slot
  SELECT * INTO v_slot
  FROM public.booking_recovery_slots
  WHERE workspace_id = p_workspace_id
    AND id = v_proposal.slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Slot not found in workspace'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_slot.status != 'AVAILABLE' THEN
    RAISE EXCEPTION 'SLOT_NOT_AVAILABLE: Slot is not available'
      USING ERRCODE = '40001';
  END IF;

  IF v_slot.valid_until <= now() THEN
    RAISE EXCEPTION 'SLOT_EXPIRED: Slot has expired'
      USING ERRCODE = '40001';
  END IF;

  IF v_slot.version != v_proposal.slot_version THEN
    RAISE EXCEPTION 'SLOT_VERSION_CONFLICT: Slot version conflict'
      USING ERRCODE = '40001';
  END IF;

  -- Validate slot snapshot attributes against proposal snapshot
  IF v_slot.service_id IS DISTINCT FROM v_proposal.service_id
     OR v_slot.starts_at IS DISTINCT FROM v_proposal.starts_at
     OR v_slot.ends_at IS DISTINCT FROM v_proposal.ends_at
     OR v_slot.timezone IS DISTINCT FROM v_proposal.timezone
     OR v_slot.catalog_version IS DISTINCT FROM v_proposal.catalog_version THEN
    RAISE EXCEPTION 'SLOT_SNAPSHOT_MISMATCH: Slot snapshot attributes do not match proposal'
      USING ERRCODE = '40001';
  END IF;

  -- 10. Check existing reservations for interval overlap or uncertain end-times on same date
  IF EXISTS (
    SELECT 1 FROM public.reservations
    WHERE workspace_id = p_workspace_id
      AND status = 'CONFIRMED'
      AND (
        (
          (metadata->>'endsAt') IS NULL
          AND confirmed_at::date = v_slot.starts_at::date
        )
        OR
        (
          (metadata->>'startsAt') IS NOT NULL
          AND (metadata->>'endsAt') IS NOT NULL
          AND tstzrange((metadata->>'startsAt')::timestamptz, (metadata->>'endsAt')::timestamptz) && tstzrange(v_slot.starts_at, v_slot.ends_at)
        )
      )
  ) THEN
    RAISE EXCEPTION 'SLOT_INTERVAL_CONFLICT: Overlapping confirmed reservation or uncertain end-time exists on this date'
      USING ERRCODE = '40001';
  END IF;

  -- 11. Validate & Atomically Consume Durable Owner Approval Record
  SELECT * INTO v_approval
  FROM public.booking_recovery_approvals
  WHERE workspace_id = p_workspace_id
    AND case_id = p_case_id
    AND step_kind = 'BOOK'
    AND payload_fingerprint = p_fingerprint
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN: Active owner booking approval not found'
      USING ERRCODE = '42501';
  END IF;

  IF v_approval.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'APPROVAL_ALREADY_CONSUMED: Owner approval was already consumed'
      USING ERRCODE = '40001';
  END IF;

  IF v_approval.expires_at <= now() THEN
    RAISE EXCEPTION 'APPROVAL_EXPIRED: Owner approval expired at %', v_approval.expires_at
      USING ERRCODE = '40001';
  END IF;

  IF v_approval.case_version != p_expected_version
     OR v_approval.catalog_version != v_proposal.catalog_version
     OR v_approval.slot_version != v_proposal.slot_version THEN
    RAISE EXCEPTION 'APPROVAL_VERSION_MISMATCH: Approval bound versions do not match proposal/case'
      USING ERRCODE = '40001';
  END IF;

  -- Exact binding of approval.source_message_id to inbound acceptance message id (no null fallback)
  IF v_approval.source_message_id IS NULL
     OR v_approval.source_message_id IS DISTINCT FROM p_inbound_acceptance_message_id THEN
    RAISE EXCEPTION 'ACCEPTANCE_BINDING_MISMATCH: Approval source message differs from confirmation message'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.booking_recovery_approvals
  SET consumed_at = now()
  WHERE id = v_approval.id;

  -- 12. Insert Confirmed Reservation Spine Row
  v_reservation_id := 'bk_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.reservations (
    id,
    workspace_id,
    mission_id,
    slot_id,
    customer_id,
    customer_name,
    service_id,
    service_name,
    status,
    deposit_krw,
    total_amount_krw,
    channel_source,
    proof_id,
    evidence_id,
    confirmed_at,
    metadata
  ) VALUES (
    v_reservation_id,
    p_workspace_id,
    v_case.mission_id,
    v_slot.id::text,
    v_case.customer_ref,
    '고객님',
    v_proposal.service_id::text,
    v_proposal.service_name,
    'CONFIRMED',
    v_proposal.deposit_krw,
    v_proposal.total_amount_krw,
    'INSTAGRAM_DM',
    p_inbound_acceptance_message_id::text,
    p_fingerprint,
    now(),
    jsonb_build_object(
      'source', 'booking_recovery',
      'caseId', p_case_id,
      'proposalRevision', p_proposal_revision,
      'slotId', v_slot.id,
      'startsAt', v_slot.starts_at,
      'endsAt', v_slot.ends_at
    )
  );

  -- 13. Update Slot Status to BOOKED
  UPDATE public.booking_recovery_slots
  SET status = 'BOOKED'
  WHERE id = v_slot.id;

  -- 14. Transition Case to BOOKING_CONFIRMED & Record Acceptance Msg Ref
  UPDATE public.booking_recovery_cases
  SET stage = 'BOOKING_CONFIRMED',
      version = v_case.version + 1,
      accepted_inbound_message_id = p_inbound_acceptance_message_id,
      updated_at = now()
  WHERE id = p_case_id
  RETURNING * INTO v_updated_case;

  -- 15. Update Marketing Mission Spine & Record Mission Events
  SELECT * INTO v_mission
  FROM public.marketing_missions
  WHERE id = v_case.mission_id
  FOR UPDATE;

  UPDATE public.marketing_missions
  SET status = 'BOOKED',
      metadata = jsonb_set(
        coalesce(metadata, '{}'::jsonb),
        '{bookingId}',
        to_jsonb(v_reservation_id)
      ),
      updated_at = now()
  WHERE id = v_case.mission_id;

  INSERT INTO public.mission_events (
    workspace_id,
    mission_id,
    trace_id,
    from_status,
    to_status,
    actor_type,
    actor_id,
    event_name,
    payload,
    occurred_at
  ) VALUES (
    p_workspace_id,
    v_case.mission_id,
    coalesce(v_mission.trace_id, 'trc-recovery-' || p_case_id),
    v_mission.status,
    'BOOKED',
    'user',
    p_actor_id::text,
    'BOOKING_CONFIRMED',
    jsonb_build_object(
      'reservationId', v_reservation_id,
      'slotId', v_slot.id,
      'caseId', p_case_id,
      'proposalRevision', p_proposal_revision,
      'customerId', v_case.customer_ref
    ),
    now()
  );

  -- 16. Append Audit Step Log
  INSERT INTO public.booking_recovery_steps (
    workspace_id,
    case_id,
    kind,
    status,
    input_fingerprint,
    idempotency_key,
    attempt,
    actor_id,
    evidence_ref
  ) VALUES (
    p_workspace_id,
    p_case_id,
    'CONFIRM_BOOKING',
    'COMPLETED',
    p_fingerprint,
    'confirm:' || p_case_id || ':' || v_updated_case.version,
    1,
    p_actor_id::text,
    v_reservation_id
  );

  RETURN jsonb_build_object(
    'case', to_jsonb(v_updated_case),
    'reservation_id', v_reservation_id,
    'slot_id', v_slot.id,
    'confirmed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_booking_recovery(uuid, uuid, int, int, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_booking_recovery(uuid, uuid, int, int, uuid, uuid, text) TO service_role;
