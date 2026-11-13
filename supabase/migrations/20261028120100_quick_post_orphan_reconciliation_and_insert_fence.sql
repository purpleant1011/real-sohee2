-- ANI-1879: Durable DB atomic orphan reconciliation and mission persistence fencing.
-- Serializes reconcile and insert races using the same quick_post_credit_reservations row lock.
-- Prevents stale workers from inserting missions for released reservations.
-- If a mission already exists at reconciliation time, it is preserved (no refund) for resume/settlement.

-- 1. Fencing trigger on marketing_missions to block late inserts on released reservations
CREATE OR REPLACE FUNCTION public.fence_quick_post_mission_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_op_key text;
  v_res_state text;
BEGIN
  v_op_key := NEW.metadata->'quick'->>'creditOperationKey';

  IF v_op_key IS NOT NULL AND v_op_key <> '' THEN
    SELECT state INTO v_res_state
      FROM public.quick_post_credit_reservations
      WHERE workspace_id = NEW.workspace_id
        AND operation_key = v_op_key
      FOR UPDATE;
  ELSE
    SELECT state INTO v_res_state
      FROM public.quick_post_credit_reservations
      WHERE workspace_id = NEW.workspace_id
        AND mission_id = NEW.id
      ORDER BY revision ASC
      LIMIT 1
      FOR UPDATE;
  END IF;

  IF FOUND AND v_res_state = 'released' THEN
    RAISE EXCEPTION 'QUICK_POST_RESERVATION_RELEASED' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fence_quick_post_mission_insert ON public.marketing_missions;
CREATE TRIGGER trg_fence_quick_post_mission_insert
  BEFORE INSERT ON public.marketing_missions
  FOR EACH ROW
  EXECUTE FUNCTION public.fence_quick_post_mission_insert();

-- 2. Atomic orphan reconciliation RPC
CREATE OR REPLACE FUNCTION public.reconcile_quick_post_orphan(
  p_workspace_id uuid,
  p_reservation_id uuid,
  p_operation_key text,
  p_max_lease_seconds integer DEFAULT 120
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.quick_post_credit_reservations%ROWTYPE;
  v_mission_id uuid;
  v_mission_status text;
  v_execution_state text;
  v_outcome_state text;
  v_lease_age interval;
BEGIN
  IF p_workspace_id IS NULL OR p_reservation_id IS NULL OR p_operation_key IS NULL THEN
    RAISE EXCEPTION 'QUICK_POST_RECONCILE_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF p_max_lease_seconds IS NULL OR p_max_lease_seconds < 120 THEN
    RAISE EXCEPTION 'QUICK_POST_INVALID_LEASE_DURATION' USING ERRCODE = 'P0001';
  END IF;

  -- Step 1: Lock workspace_credit_states first to preserve identical lock hierarchy with settle/release
  PERFORM 1 FROM public.workspace_credit_states WHERE workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUICK_POST_CREDIT_STATE_MISSING' USING ERRCODE = 'P0001';
  END IF;

  -- Step 2: Lock reservation row (serializes with mission insert trigger)
  SELECT * INTO v_row FROM public.quick_post_credit_reservations
    WHERE id = p_reservation_id AND workspace_id = p_workspace_id AND operation_key = p_operation_key
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUICK_POST_RESERVATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Already released
  IF v_row.state = 'released' THEN
    RETURN jsonb_build_object(
      'reconciled', false,
      'state', 'released',
      'missionExists', false
    );
  END IF;

  -- Already settled
  IF v_row.state = 'settled' THEN
    SELECT id, status, metadata->>'execution_state', metadata->>'outcome_state'
      INTO v_mission_id, v_mission_status, v_execution_state, v_outcome_state
      FROM public.marketing_missions
      WHERE id = v_row.mission_id AND workspace_id = p_workspace_id;

    RETURN jsonb_build_object(
      'reconciled', false,
      'state', 'settled',
      'missionExists', (v_mission_id IS NOT NULL),
      'missionId', v_mission_id,
      'missionStatus', v_mission_status,
      'executionState', v_execution_state,
      'outcomeState', v_outcome_state
    );
  END IF;

  -- State is 'reserved': Check if mission already exists!
  SELECT id, status, metadata->>'execution_state', metadata->>'outcome_state'
    INTO v_mission_id, v_mission_status, v_execution_state, v_outcome_state
    FROM public.marketing_missions
    WHERE id = v_row.mission_id AND workspace_id = p_workspace_id;

  IF v_mission_id IS NOT NULL THEN
    -- Mission already exists! DO NOT REFUND! Reopen/resume same mission.
    RETURN jsonb_build_object(
      'reconciled', false,
      'state', 'reserved',
      'missionExists', true,
      'missionId', v_mission_id,
      'missionStatus', v_mission_status,
      'executionState', v_execution_state,
      'outcomeState', v_outcome_state
    );
  END IF;

  -- Mission does not exist. Check lease age. Fail-closed on future timestamp.
  IF v_row.created_at > now() THEN
    RAISE EXCEPTION 'QUICK_POST_INVALID_RESERVATION_TIME' USING ERRCODE = 'P0001';
  END IF;

  v_lease_age := now() - v_row.created_at;
  IF v_lease_age < make_interval(secs => p_max_lease_seconds) THEN
    -- Active in-flight lease (<120s): preserve reservation, do not refund, do not advance
    RETURN jsonb_build_object(
      'reconciled', false,
      'state', 'reserved',
      'missionExists', false,
      'activeLease', true
    );
  END IF;

  -- Expired orphan lease (>=120s): atomic refund and release (workspace_credit_states already locked at Step 1)
  INSERT INTO public.credit_ledger_entries
    (workspace_id, account_id, reservation_id, kind, action, amount, idempotency_key)
    VALUES (p_workspace_id, v_row.account_id, NULL, 'release',
      'text_generation', v_row.credits, p_operation_key || ':refund');

  UPDATE public.workspace_credit_states
    SET total_available_credits = total_available_credits + v_row.credits, updated_at = now()
    WHERE workspace_id = p_workspace_id;

  UPDATE public.quick_post_credit_reservations
    SET state = 'released'
    WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'reconciled', true,
    'state', 'released',
    'missionExists', false,
    'refundedCredits', v_row.credits
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_quick_post_orphan(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_quick_post_orphan(uuid, uuid, text, integer) TO service_role;

-- 3. Atomic release RPC hardening (protects committed mission against persistence response loss race)
-- Revision 1 reservations are not refunded if the mission was actually committed to DB.
-- Normal refund paths for subsequent failed revisions (revision > 1) are preserved.
CREATE OR REPLACE FUNCTION public.release_quick_post_credits(
  p_workspace_id uuid,
  p_reservation_id uuid,
  p_operation_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.quick_post_credit_reservations%ROWTYPE;
  v_mission_id uuid;
BEGIN
  -- Step 1: Lock workspace_credit_states first
  PERFORM 1 FROM public.workspace_credit_states WHERE workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUICK_POST_CREDIT_STATE_MISSING' USING ERRCODE = 'P0001';
  END IF;

  -- Step 2: Lock reservation row
  SELECT * INTO v_row FROM public.quick_post_credit_reservations
    WHERE id = p_reservation_id AND workspace_id = p_workspace_id AND operation_key = p_operation_key
    FOR UPDATE;

  IF NOT FOUND OR v_row.state = 'settled' THEN
    RAISE EXCEPTION 'QUICK_POST_CREDIT_RESERVATION_STALE' USING ERRCODE = 'P0001';
  END IF;

  -- Protect against persistence response loss: if revision 1 mission exists, do not refund!
  IF v_row.revision = 1 THEN
    SELECT id INTO v_mission_id FROM public.marketing_missions
      WHERE id = v_row.mission_id AND workspace_id = p_workspace_id;
    IF v_mission_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'reservationId', v_row.id,
        'state', 'reserved',
        'missionExists', true
      );
    END IF;
  END IF;

  IF v_row.state = 'reserved' THEN
    INSERT INTO public.credit_ledger_entries
      (workspace_id, account_id, reservation_id, kind, action, amount, idempotency_key)
      VALUES (p_workspace_id, v_row.account_id, NULL, 'release',
        'text_generation', v_row.credits, p_operation_key || ':refund');

    UPDATE public.workspace_credit_states
      SET total_available_credits = total_available_credits + v_row.credits, updated_at = now()
      WHERE workspace_id = p_workspace_id;

    UPDATE public.quick_post_credit_reservations
      SET state = 'released'
      WHERE id = v_row.id;
  END IF;

  RETURN jsonb_build_object('reservationId', v_row.id, 'state', 'released');
END;
$$;

REVOKE ALL ON FUNCTION public.release_quick_post_credits(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_quick_post_credits(uuid, uuid, text) TO service_role;
