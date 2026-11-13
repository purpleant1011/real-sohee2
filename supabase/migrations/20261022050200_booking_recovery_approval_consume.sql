-- ANI-1585 / ANI-1607 (W4 contract 3 + 4, SQL side): atomic send approval and single-use consumption.
-- Forward-only; adding this file does not change any operational database.
--
-- Contract 3: public.approve_and_transition_recovery
--   Case transition (-> AWAITING_SEND_APPROVAL), the SEND approval row, and the audit step are one transaction.
--   The reviewed version (version the owner read) and the authorized version (version issued by this CAS)
--   are persisted separately on the approval row; they are never inferred by arithmetic by readers.
-- Contract 4: public.claim_booking_recovery_step (kind = 'SEND_DM')
--   Claiming the send lease and stamping the single-use approval (consumed_at / consumed_by_step_id) are one
--   transaction serialized on the approval row. An expired SEND_DM lease is never re-claimed for sending
--   (possible duplicate DM); it answers EXPIRED_LEASE_RECONCILE_ONLY so only read-only reconciliation can finish it.
--
-- Rollback: restore the previous claim_booking_recovery_step definition from 20261016120000 and drop
-- public.approve_and_transition_recovery. Approval/step/case rows written under this contract are evidence and are not deleted.

-- 1. Approval ledger: authorized version + consuming step (nullable: legacy rows and BOOK approvals leave them NULL)
ALTER TABLE public.booking_recovery_approvals
  ADD COLUMN IF NOT EXISTS authorized_case_version int,
  ADD COLUMN IF NOT EXISTS consumed_by_step_id uuid;

ALTER TABLE public.booking_recovery_approvals
  ADD CONSTRAINT booking_recovery_approvals_authorized_version_chk
    CHECK (authorized_case_version IS NULL OR authorized_case_version > case_version);

ALTER TABLE public.booking_recovery_approvals
  ADD CONSTRAINT booking_recovery_approvals_consumed_step_fk
    FOREIGN KEY (workspace_id, consumed_by_step_id)
    REFERENCES public.booking_recovery_steps (workspace_id, id)
    ON DELETE SET NULL (consumed_by_step_id);

-- 2. Atomic approve + transition
CREATE OR REPLACE FUNCTION public.approve_and_transition_recovery(
  p_workspace_id uuid,
  p_case_id uuid,
  p_expected_version int,
  p_actor_id uuid,
  p_fingerprint text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_case record;
  v_proposal record;
  v_step record;
  v_approval record;
  v_updated record;
  v_new_version int;
  v_approval_id uuid;
BEGIN
  -- 1. Caller authorization (active owner/manager of this workspace)
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = p_workspace_id
      AND user_id = p_actor_id
      AND role IN ('owner', 'manager')
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: Caller is not an authorized manager/owner of workspace'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Input shape (fail closed before taking locks)
  IF p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'INVALID_FINGERPRINT: A valid 64-character hex fingerprint is required'
      USING ERRCODE = '22000';
  END IF;

  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 OR length(p_idempotency_key) > 255 THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY: A non-empty idempotency key (max 255 chars) is required'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Serialize on the case row. New proposal revisions reference the case, so inserting one blocks behind this lock.
  SELECT * INTO v_case
  FROM public.booking_recovery_cases
  WHERE workspace_id = p_workspace_id
    AND id = p_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Case not found in workspace'
      USING ERRCODE = 'P0002';
  END IF;

  -- 4. Idempotent replay: the same logical request returns the originally issued approval, writing nothing.
  SELECT * INTO v_step
  FROM public.booking_recovery_steps
  WHERE workspace_id = p_workspace_id
    AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_step.case_id != p_case_id OR v_step.kind != 'APPROVE_SEND' OR v_step.input_fingerprint != p_fingerprint THEN
      RAISE EXCEPTION 'IDEMPOTENCY_BINDING_CONFLICT: Idempotency key is already bound to a different case/kind/fingerprint'
        USING ERRCODE = '22000';
    END IF;

    SELECT * INTO v_approval
    FROM public.booking_recovery_approvals
    WHERE workspace_id = p_workspace_id
      AND case_id = p_case_id
      AND step_kind = 'SEND'
      AND payload_fingerprint = p_fingerprint;

    IF NOT FOUND OR v_approval.authorized_case_version IS NULL THEN
      RAISE EXCEPTION 'REPLAY_EVIDENCE_MISMATCH: Original approval for this request was not found'
        USING ERRCODE = '40001';
    END IF;

    RETURN jsonb_build_object(
      'approval_id', v_approval.id,
      'case_id', p_case_id,
      'reviewed_case_version', v_approval.case_version,
      'authorized_case_version', v_approval.authorized_case_version,
      'stage', v_case.stage,
      'replayed', true,
      'expires_at', v_approval.expires_at,
      'case', to_jsonb(v_case)
    );
  END IF;

  -- 5. Optimistic version + stage guards
  IF v_case.version != p_expected_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: Expected case version % but found %', p_expected_version, v_case.version
      USING ERRCODE = '40001';
  END IF;

  IF v_case.stage NOT IN ('DRAFT_READY', 'HUMAN_REVIEW') THEN
    RAISE EXCEPTION 'INVALID_STAGE_TRANSITION: Cannot approve send from stage %', v_case.stage
      USING ERRCODE = '22000';
  END IF;

  -- 6. The approved payload must be the latest persisted proposal; approval metadata is derived here, never trusted from the caller.
  SELECT * INTO v_proposal
  FROM public.booking_recovery_proposals
  WHERE workspace_id = p_workspace_id
    AND case_id = p_case_id
  ORDER BY revision DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: No proposal found for case'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_proposal.payload_fingerprint IS DISTINCT FROM p_fingerprint THEN
    RAISE EXCEPTION 'FINGERPRINT_MISMATCH: Approved fingerprint differs from the latest proposal'
      USING ERRCODE = '40001';
  END IF;

  IF v_proposal.valid_until <= now() THEN
    RAISE EXCEPTION 'PROPOSAL_EXPIRED: The proposal validity window has passed'
      USING ERRCODE = '40001';
  END IF;

  -- 7. One approval per (case, SEND, fingerprint). A consumed or older approval is never silently reused.
  IF EXISTS (
    SELECT 1 FROM public.booking_recovery_approvals
    WHERE workspace_id = p_workspace_id
      AND case_id = p_case_id
      AND step_kind = 'SEND'
      AND payload_fingerprint = p_fingerprint
  ) THEN
    RAISE EXCEPTION 'APPROVAL_ALREADY_EXISTS: An approval already exists for this payload; prepare a new proposal revision'
      USING ERRCODE = '40001';
  END IF;

  v_new_version := v_case.version + 1;
  v_approval_id := gen_random_uuid();

  -- 8. Approval ledger row
  INSERT INTO public.booking_recovery_approvals (
    id,
    workspace_id,
    case_id,
    step_kind,
    payload_fingerprint,
    case_version,
    authorized_case_version,
    source_message_id,
    catalog_version,
    slot_version,
    approved_by,
    expires_at
  ) VALUES (
    v_approval_id,
    p_workspace_id,
    p_case_id,
    'SEND',
    p_fingerprint,
    v_case.version,
    v_new_version,
    v_proposal.source_inbound_message_id,
    v_proposal.catalog_version,
    v_proposal.slot_version,
    p_actor_id,
    v_proposal.valid_until
  );

  -- 9. Case transition
  UPDATE public.booking_recovery_cases
  SET stage = 'AWAITING_SEND_APPROVAL',
      version = v_new_version,
      updated_at = now()
  WHERE workspace_id = p_workspace_id
    AND id = p_case_id
  RETURNING * INTO v_updated;

  -- 10. Audit step (links the approval id as evidence)
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
    'APPROVE_SEND',
    'COMPLETED',
    p_fingerprint,
    p_idempotency_key,
    1,
    p_actor_id::text,
    v_approval_id::text
  );

  RETURN jsonb_build_object(
    'approval_id', v_approval_id,
    'case_id', p_case_id,
    'reviewed_case_version', v_case.version,
    'authorized_case_version', v_new_version,
    'stage', 'AWAITING_SEND_APPROVAL',
    'replayed', false,
    'expires_at', v_proposal.valid_until,
    'case', to_jsonb(v_updated)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_and_transition_recovery(uuid, uuid, int, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_and_transition_recovery(uuid, uuid, int, uuid, text, text) TO service_role;

-- 3. claim_booking_recovery_step: SEND_DM claims consume the single-use approval atomically.
-- All other kinds keep the exact previous behavior (including expired-lease reclaim).
CREATE OR REPLACE FUNCTION public.claim_booking_recovery_step(
  p_workspace_id uuid,
  p_case_id uuid,
  p_kind text,
  p_idempotency_key text,
  p_actor_id uuid,
  p_input_fingerprint text,
  p_lease_seconds int DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_step record;
  v_approval record;
  v_has_approval boolean := false;
  v_lease_until timestamptz;
  v_new_claim_token uuid;
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

  -- 2. Validate lease duration bounds (1 to 3600 seconds)
  IF p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'INVALID_LEASE_DURATION: lease_seconds must be between 1 and 3600'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Verify Case exists
  IF NOT EXISTS (
    SELECT 1 FROM public.booking_recovery_cases
    WHERE workspace_id = p_workspace_id AND id = p_case_id
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: Case % not found in workspace %', p_case_id, p_workspace_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 4. Validate Fingerprint format
  IF p_input_fingerprint IS NULL OR p_input_fingerprint !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'INVALID_FINGERPRINT: Valid 64-char hex SHA256 required'
      USING ERRCODE = '22000';
  END IF;

  v_lease_until := now() + (p_lease_seconds || ' seconds')::interval;

  -- 4b. SEND_DM: serialize every claim for this payload on the single-use approval row.
  -- (case_id, step_kind, fingerprint) is unique, so at most one row. Everything below re-reads after this lock.
  IF p_kind = 'SEND_DM' THEN
    SELECT * INTO v_approval
    FROM public.booking_recovery_approvals
    WHERE workspace_id = p_workspace_id
      AND case_id = p_case_id
      AND step_kind = 'SEND'
      AND payload_fingerprint = p_input_fingerprint
    FOR UPDATE;
    v_has_approval := FOUND;
  END IF;

  -- 5. Check if Step row already exists with row lock
  SELECT * INTO v_step
  FROM public.booking_recovery_steps
  WHERE workspace_id = p_workspace_id
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    -- Invariant: Reject logical operation binding conflict (different case, kind, or fingerprint)
    IF v_step.case_id != p_case_id OR v_step.kind != p_kind OR v_step.input_fingerprint != p_input_fingerprint THEN
      RAISE EXCEPTION 'IDEMPOTENCY_BINDING_CONFLICT: Step % is already bound to a different case/kind/fingerprint', p_idempotency_key
        USING ERRCODE = '22000';
    END IF;

    IF v_step.status = 'COMPLETED' THEN
      RETURN jsonb_build_object('claimed', false, 'reason', 'ALREADY_COMPLETED', 'step', to_jsonb(v_step));
    ELSIF v_step.status = 'CLAIMED' AND v_step.lease_until IS NOT NULL AND v_step.lease_until > now() THEN
      RETURN jsonb_build_object('claimed', false, 'reason', 'LOCKED_BY_ANOTHER_WORKER', 'lease_until', v_step.lease_until);
    ELSIF v_step.status = 'CLAIMED' AND (v_step.lease_until IS NULL OR v_step.lease_until <= now()) THEN
      IF p_kind = 'SEND_DM' THEN
        -- The provider call may already have started under the expired lease: never send again, reconcile read-only.
        RETURN jsonb_build_object('claimed', false, 'reason', 'EXPIRED_LEASE_RECONCILE_ONLY', 'step', to_jsonb(v_step));
      END IF;

      -- Reclaim expired lease with fresh claim_token and incremented attempt
      v_new_claim_token := gen_random_uuid();
      UPDATE public.booking_recovery_steps
      SET attempt = attempt + 1,
          claim_token = v_new_claim_token,
          lease_until = v_lease_until,
          actor_id = p_actor_id::text
      WHERE id = v_step.id
      RETURNING * INTO v_step;

      RETURN jsonb_build_object(
        'claimed', true,
        'reclaimed', true,
        'claim_token', v_new_claim_token,
        'attempt', v_step.attempt,
        'step', to_jsonb(v_step)
      );
    ELSE
      RETURN jsonb_build_object('claimed', false, 'reason', 'STEP_FINALIZED', 'status', v_step.status);
    END IF;
  ELSE
    -- 5b. SEND_DM first claim requires an active, unconsumed approval from a still-authorized approver.
    IF p_kind = 'SEND_DM' THEN
      IF NOT v_has_approval
         OR v_approval.consumed_at IS NOT NULL
         OR v_approval.expires_at <= now() THEN
        RETURN jsonb_build_object(
          'claimed', false,
          'reason', 'APPROVAL_NOT_FOUND_OR_EXPIRED_OR_CONSUMED'
        );
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.workspace_members
        WHERE workspace_id = p_workspace_id
          AND user_id = v_approval.approved_by
          AND role IN ('owner', 'manager')
          AND status = 'active'
      ) THEN
        RAISE EXCEPTION 'FORBIDDEN: Approving member is no longer an authorized manager/owner'
          USING ERRCODE = '42501';
      END IF;
    END IF;

    -- Initial Claim with concurrency race safety (ON CONFLICT DO NOTHING)
    v_new_claim_token := gen_random_uuid();
    INSERT INTO public.booking_recovery_steps (
      workspace_id,
      case_id,
      kind,
      status,
      input_fingerprint,
      idempotency_key,
      attempt,
      claim_token,
      actor_id,
      lease_until
    ) VALUES (
      p_workspace_id,
      p_case_id,
      p_kind,
      'CLAIMED',
      p_input_fingerprint,
      p_idempotency_key,
      1,
      v_new_claim_token,
      p_actor_id::text,
      v_lease_until
    )
    ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
    RETURNING * INTO v_step;

    IF v_step.id IS NOT NULL THEN
      IF p_kind = 'SEND_DM' THEN
        -- Same transaction as the lease: consume the approval exactly once.
        UPDATE public.booking_recovery_approvals
        SET consumed_at = now(),
            consumed_by_step_id = v_step.id
        WHERE id = v_approval.id
          AND consumed_at IS NULL;
      END IF;

      RETURN jsonb_build_object(
        'claimed', true,
        'reclaimed', false,
        'claim_token', v_new_claim_token,
        'attempt', 1,
        'step', to_jsonb(v_step)
      );
    ELSE
      -- Concurrent insertion happened: re-read locked row
      SELECT * INTO v_step
      FROM public.booking_recovery_steps
      WHERE workspace_id = p_workspace_id
        AND idempotency_key = p_idempotency_key
      FOR UPDATE;

      RETURN jsonb_build_object(
        'claimed', false,
        'reason', 'LOCKED_BY_ANOTHER_WORKER',
        'lease_until', v_step.lease_until
      );
    END IF;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_booking_recovery_step(uuid, uuid, text, text, uuid, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_booking_recovery_step(uuid, uuid, text, text, uuid, text, int) TO service_role;
