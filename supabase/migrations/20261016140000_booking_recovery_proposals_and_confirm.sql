-- ==============================================================================
-- Migration: 20261016140000_booking_recovery_proposals_and_confirm.sql
-- Description: Booking Recovery Proposals Ledger, Step Finish CAS,
--              Approval Consumption, and Atomic Booking Confirmation RPC.
-- ==============================================================================

-- 1. Schema Additions to existing recovery tables
ALTER TABLE public.booking_recovery_approvals
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz;

ALTER TABLE public.booking_recovery_cases
  ADD COLUMN IF NOT EXISTS accepted_inbound_message_id uuid
    REFERENCES public.instagram_dm_messages(id) ON DELETE SET NULL;

-- 2. booking_recovery_proposals table (authoritative snapshot per revision)
CREATE TABLE IF NOT EXISTS public.booking_recovery_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  revision int NOT NULL DEFAULT 1 CHECK (revision > 0),
  source_inbound_message_id uuid NOT NULL,
  source_thread_id uuid NOT NULL,
  service_id uuid NOT NULL,
  catalog_version text NOT NULL,
  service_name text NOT NULL,
  total_amount_krw int NOT NULL CHECK (total_amount_krw >= 0),
  deposit_krw int NOT NULL CHECK (deposit_krw >= 0),
  slot_id uuid NOT NULL,
  slot_version int NOT NULL CHECK (slot_version > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Seoul',
  availability_confirmed_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  dm_draft_id uuid,
  reply_text text NOT NULL,
  payload_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT booking_recovery_proposals_duration_chk CHECK (ends_at > starts_at),
  CONSTRAINT booking_recovery_proposals_ws_case_rev_uniq
    UNIQUE (workspace_id, case_id, revision),
  CONSTRAINT booking_recovery_proposals_ws_id_uniq
    UNIQUE (workspace_id, id),
  CONSTRAINT booking_recovery_proposals_ws_case_fk
    FOREIGN KEY (workspace_id, case_id)
    REFERENCES public.booking_recovery_cases (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT booking_recovery_proposals_ws_source_msg_fk
    FOREIGN KEY (workspace_id, source_inbound_message_id)
    REFERENCES public.instagram_dm_messages (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT booking_recovery_proposals_ws_thread_fk
    FOREIGN KEY (workspace_id, source_thread_id)
    REFERENCES public.instagram_dm_threads (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT booking_recovery_proposals_ws_service_fk
    FOREIGN KEY (workspace_id, service_id)
    REFERENCES public.workspace_products_services (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT booking_recovery_proposals_ws_slot_fk
    FOREIGN KEY (workspace_id, slot_id)
    REFERENCES public.booking_recovery_slots (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_booking_recovery_proposals_ws_case
  ON public.booking_recovery_proposals (workspace_id, case_id, revision DESC);

-- Enable RLS for proposals
ALTER TABLE public.booking_recovery_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_recovery_proposals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.booking_recovery_proposals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_recovery_proposals TO service_role;

DROP POLICY IF EXISTS booking_recovery_proposals_members_select ON public.booking_recovery_proposals;
CREATE POLICY booking_recovery_proposals_members_select ON public.booking_recovery_proposals
  FOR SELECT TO authenticated
  USING ((SELECT private.is_workspace_member(workspace_id)));

DROP POLICY IF EXISTS booking_recovery_proposals_service_all ON public.booking_recovery_proposals;
CREATE POLICY booking_recovery_proposals_service_all ON public.booking_recovery_proposals
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 3. RPC: finish_booking_recovery_step (Atomic CAS for execution step completion)
CREATE OR REPLACE FUNCTION public.finish_booking_recovery_step(
  p_workspace_id uuid,
  p_case_id uuid,
  p_step_id uuid,
  p_claim_token uuid,
  p_attempt int,
  p_input_fingerprint text,
  p_status text,
  p_provider_msg_id text DEFAULT NULL,
  p_evidence_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_step record;
  v_updated record;
BEGIN
  IF p_status NOT IN ('COMPLETED', 'FAILED') THEN
    RAISE EXCEPTION 'INVALID_STATUS: Status must be COMPLETED or FAILED, got %', p_status
      USING ERRCODE = '22000';
  END IF;

  SELECT * INTO v_step
  FROM public.booking_recovery_steps
  WHERE workspace_id = p_workspace_id
    AND id = p_step_id
    AND case_id = p_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Step % not found in workspace %', p_step_id, p_workspace_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_step.status != 'CLAIMED' THEN
    RAISE EXCEPTION 'STEP_NOT_CLAIMED: Step % is currently in status %', p_step_id, v_step.status
      USING ERRCODE = '40001';
  END IF;

  IF v_step.claim_token != p_claim_token OR v_step.attempt != p_attempt OR v_step.input_fingerprint != p_input_fingerprint THEN
    RAISE EXCEPTION 'STEP_FINISH_CAS_FAILED: Stale worker finish attempt (token, attempt or fingerprint mismatch)'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.booking_recovery_steps
  SET status = p_status,
      provider_message_id = COALESCE(p_provider_msg_id, provider_message_id),
      evidence_ref = COALESCE(p_evidence_ref, evidence_ref),
      lease_until = NULL
  WHERE id = p_step_id
  RETURNING * INTO v_updated;

  RETURN to_jsonb(v_updated);
END;
$$;

-- 4. RPC: confirm_booking_recovery (Atomic multi-row reservation commitment with fail-closed integrity)
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
  v_case record;
  v_proposal record;
  v_accepted_proposal record;
  v_catalog record;
  v_slot record;
  v_approval record;
  v_acceptance_msg record;
  v_initial_proposal_created_at timestamptz;
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

  -- 2. Lock & Validate Proposal Snapshot
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

  -- Idempotent Replay Check: If already confirmed with same proposal, return existing booking
  IF v_case.stage = 'BOOKING_CONFIRMED' THEN
    SELECT id INTO v_reservation_id
    FROM public.reservations
    WHERE workspace_id = p_workspace_id
      AND (metadata->>'caseId') = p_case_id::text
      AND (metadata->>'proposalRevision') = p_proposal_revision::text;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'case', to_jsonb(v_case),
        'reservation_id', v_reservation_id,
        'slot_id', v_proposal.slot_id,
        'confirmed_at', v_case.updated_at
      );
    END IF;
  END IF;

  IF v_case.version != p_expected_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: Expected case version % but found %', p_expected_version, v_case.version
      USING ERRCODE = '40001';
  END IF;

  IF v_case.stage NOT IN ('CUSTOMER_ACCEPTED', 'AWAITING_BOOKING_APPROVAL') THEN
    RAISE EXCEPTION 'INVALID_STAGE: Case % is in stage %, cannot confirm booking', p_case_id, v_case.stage
      USING ERRCODE = '22000';
  END IF;

  -- 4. Lock & Validate Catalog Service (Active & Price Unchanged)
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
    RAISE EXCEPTION 'CATALOG_PRICE_CHANGED: Catalog price (%) changed from proposal (%)', v_catalog.price, v_proposal.total_amount_krw
      USING ERRCODE = '40001';
  END IF;

  -- 5. Lock & Validate Slot
  SELECT * INTO v_slot
  FROM public.booking_recovery_slots
  WHERE workspace_id = p_workspace_id
    AND id = v_proposal.slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Slot % not found in workspace %', v_proposal.slot_id, p_workspace_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_slot.status != 'AVAILABLE' THEN
    RAISE EXCEPTION 'SLOT_NOT_AVAILABLE: Slot % is in status %', v_slot.id, v_slot.status
      USING ERRCODE = '40001';
  END IF;

  IF v_slot.valid_until <= now() THEN
    RAISE EXCEPTION 'SLOT_EXPIRED: Slot % expired at %', v_slot.id, v_slot.valid_until
      USING ERRCODE = '40001';
  END IF;

  IF v_slot.version != v_proposal.slot_version THEN
    RAISE EXCEPTION 'SLOT_VERSION_CONFLICT: Proposal slot version % does not match current slot version %', v_proposal.slot_version, v_slot.version
      USING ERRCODE = '40001';
  END IF;

  -- 6. Check existing reservations for interval overlap or uncertain end-times on same date
  IF EXISTS (
    SELECT 1 FROM public.reservations
    WHERE workspace_id = p_workspace_id
      AND status = 'CONFIRMED'
      AND (
        -- Uncertain endsAt on same calendar date
        (
          (metadata->>'endsAt') IS NULL
          AND confirmed_at::date = v_slot.starts_at::date
        )
        OR
        -- Direct time interval overlap
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

  -- 7. Validate & Atomically Consume Durable Owner Approval Record
  SELECT * INTO v_approval
  FROM public.booking_recovery_approvals
  WHERE workspace_id = p_workspace_id
    AND case_id = p_case_id
    AND step_kind = 'BOOK'
    AND payload_fingerprint = p_fingerprint
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN: Active owner booking approval not found for fingerprint %', p_fingerprint
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

  UPDATE public.booking_recovery_approvals
  SET consumed_at = now()
  WHERE id = v_approval.id;

  -- 8. Validate Customer Inbound Acceptance Message Evidence (with sent_at check)
  SELECT * INTO v_acceptance_msg
  FROM public.instagram_dm_messages
  WHERE workspace_id = p_workspace_id
    AND id = p_inbound_acceptance_message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Acceptance message % not found in workspace %', p_inbound_acceptance_message_id, p_workspace_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_acceptance_msg.sender_type != 'customer' THEN
    RAISE EXCEPTION 'INVALID_ACCEPTANCE: Acceptance message sender_type must be customer'
      USING ERRCODE = '22000';
  END IF;

  IF v_acceptance_msg.sender_id != v_case.customer_ref THEN
    RAISE EXCEPTION 'INVALID_ACCEPTANCE: Customer ref mismatch between case (%) and acceptance message (%)', v_case.customer_ref, v_acceptance_msg.sender_id
      USING ERRCODE = '22000';
  END IF;

  IF v_acceptance_msg.thread_id != v_case.source_thread_id THEN
    RAISE EXCEPTION 'INVALID_ACCEPTANCE: Thread mismatch between case (%) and acceptance message (%)', v_case.source_thread_id, v_acceptance_msg.thread_id
      USING ERRCODE = '22000';
  END IF;

  -- Strictly verify customer acceptance terms:
  -- Find the latest proposal snapshot created before or at the customer's acceptance message sent_at
  SELECT * INTO v_accepted_proposal
  FROM public.booking_recovery_proposals
  WHERE workspace_id = p_workspace_id
    AND case_id = p_case_id
    AND created_at <= v_acceptance_msg.sent_at
  ORDER BY revision DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_ACCEPTANCE: Acceptance message sent_at (%) is earlier than initial proposal creation', v_acceptance_msg.sent_at
      USING ERRCODE = '22000';
  END IF;

  -- Terms Invariance Check:
  -- If core offer terms (service, price, deposit, starts_at, ends_at) changed between the proposal the customer accepted
  -- and the proposal being confirmed (v_proposal), the customer's previous acceptance cannot be reused.
  IF v_proposal.service_id != v_accepted_proposal.service_id
     OR v_proposal.total_amount_krw != v_accepted_proposal.total_amount_krw
     OR v_proposal.deposit_krw != v_accepted_proposal.deposit_krw
     OR v_proposal.starts_at != v_accepted_proposal.starts_at
     OR v_proposal.ends_at != v_accepted_proposal.ends_at THEN
    RAISE EXCEPTION 'PROPOSAL_TERMS_CHANGED: Proposal terms changed in revision % (service, price, time, or deposit) and customer has not accepted the new terms', v_proposal.revision
      USING ERRCODE = '22000';
  END IF;

  -- 9. Insert Confirmed Reservation Spine Row
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

  -- 10. Update Slot Status to BOOKED
  UPDATE public.booking_recovery_slots
  SET status = 'BOOKED'
  WHERE id = v_slot.id;

  -- 11. Transition Case to BOOKING_CONFIRMED & Record Acceptance Msg Ref
  UPDATE public.booking_recovery_cases
  SET stage = 'BOOKING_CONFIRMED',
      version = v_case.version + 1,
      accepted_inbound_message_id = p_inbound_acceptance_message_id,
      updated_at = now()
  WHERE id = p_case_id
  RETURNING * INTO v_updated_case;

  -- 12. Update Marketing Mission Spine & Record Mission Events
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

  -- 13. Append Audit Step Log
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

-- Revoke all execute from public/anon/authenticated and grant to service_role only
REVOKE ALL ON FUNCTION public.finish_booking_recovery_step(uuid, uuid, uuid, uuid, int, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_booking_recovery_step(uuid, uuid, uuid, uuid, int, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.confirm_booking_recovery(uuid, uuid, int, int, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_booking_recovery(uuid, uuid, int, int, uuid, uuid, text) TO service_role;

-- 4. RPC: transition_booking_recovery (Atomic CAS + Automatic accepted_inbound_message_id binding)
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
  v_case record;
  v_updated record;
  v_is_valid_transition boolean := false;
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

  -- 3. Lock Case Row & Verify Optimistic Version
  SELECT * INTO v_case
  FROM public.booking_recovery_cases
  WHERE workspace_id = p_workspace_id
    AND id = p_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Case % not found in workspace %', p_case_id, p_workspace_id
      USING ERRCODE = 'P0002';
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

  -- 6. Update Case Stage, Version, and Accepted Inbound Message ID
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

  -- 7. Record Audit Step
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
