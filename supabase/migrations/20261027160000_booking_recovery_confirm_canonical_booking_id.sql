-- Migration: 20261027160000_booking_recovery_confirm_canonical_booking_id.sql
-- Issue: Task 8 (Recovery Confirmation Canonical Linkage)
-- Description: Re-declare confirm_booking_recovery to populate marketing_missions.booking_id (canonical column)
--              in addition to metadata->>'bookingId' for seamless consumption by mission-read-model and mission-state-machine.
--              Preserves 100% of existing thread lock, case lock, customer acceptance verification, terms invariance,
--              slot lock, interval overlap guard, owner approval consumption, and mission_events audit logging.

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
  -- Canonical booking_id and metadata->>'bookingId' are both populated atomically.
  SELECT * INTO v_mission
  FROM public.marketing_missions
  WHERE id = v_case.mission_id
  FOR UPDATE;

  UPDATE public.marketing_missions
  SET status = 'BOOKED',
      booking_id = v_reservation_id,
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
