-- ============================================================================
-- Migration: 20261021011859_operator_credit_adjustment_and_quick_post_sync.sql
-- Description:
--   1. apply_operator_credit_adjustment RPC:
--      - Enforces service-only ACL (REVOKE ALL, GRANT TO service_role)
--      - Validates caller operator is active with 'credit.adjust.request' permission
--      - Verifies account belongs to workspace
--      - Validates integer non-zero amount
--      - Dual control for high-value (> 50,000 SC) approver verification
--      - Row-lock on workspace_credit_states (FOR UPDATE)
--      - Replay idempotency check (rejects key conflicts on amount or account)
--      - Rejects negative adjustment on insufficient balance
--      - Atomically updates credit_ledger_entries + workspace_credit_states + audit_events
--   2. reserve_quick_post_credits RPC:
--      - Recognizes adjustments across workspace in single ledger semantics
--      - Supports cases where grant account differs from operator adjustment account
--      - Enforces states cap and preserves legacy weekly grant exclusions
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_operator_credit_adjustment(
  p_workspace_id UUID,
  p_account_id UUID,
  p_amount NUMERIC,
  p_reason TEXT,
  p_idempotency_key TEXT,
  p_operator_id UUID,
  p_approver_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_existing_id UUID;
  v_existing_account_id UUID;
  v_existing_amount NUMERIC;
  v_new_entry_id UUID;
  v_new_balance INTEGER;
  v_verified_account_id UUID;
  v_operator_valid BOOLEAN := FALSE;
  v_approver_valid BOOLEAN := FALSE;
  v_state public.workspace_credit_states%ROWTYPE;
BEGIN
  -- 1. Validate inputs (including NaN, Infinity, and 32-bit int bounds)
  IF p_workspace_id IS NULL OR p_account_id IS NULL OR p_operator_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CREDIT_ADJUSTMENT_INPUT';
  END IF;

  IF p_amount IS NULL
     OR p_amount::text = 'NaN'
     OR p_amount::text = 'Infinity'
     OR p_amount::text = '-Infinity'
     OR p_amount != round(p_amount)
     OR p_amount = 0
     OR p_amount > 2147483647
     OR p_amount < -2147483648 THEN
    RAISE EXCEPTION 'INVALID_CREDIT_ADJUSTMENT_AMOUNT';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  -- 2. Verify account belongs to workspace
  SELECT id INTO v_verified_account_id
  FROM public.credit_accounts
  WHERE id = p_account_id AND workspace_id = p_workspace_id;

  IF v_verified_account_id IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_WORKSPACE_MISMATCH';
  END IF;

  -- 3. Verify operator has credit.adjust.request permission and is active with matching workspace scope
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admin_members m
    JOIN public.platform_admin_role_assignments a ON a.user_id = m.user_id
    JOIN public.platform_role_permissions p ON p.role_key = a.role_key
    WHERE m.user_id = p_operator_id
      AND m.status = 'active'
      AND p.permission_key = 'credit.adjust.request'
      AND (a.workspace_id IS NULL OR a.workspace_id = p_workspace_id)
  ) INTO v_operator_valid;

  IF NOT v_operator_valid THEN
    RAISE EXCEPTION 'OPERATOR_PERMISSION_DENIED';
  END IF;

  -- 4. Dual Control for High-Value (> 50,000 SC)
  IF ABS(p_amount) > 50000 THEN
    IF p_approver_id IS NULL OR p_approver_id = p_operator_id THEN
      RAISE EXCEPTION 'DUAL_CONTROL_APPROVER_REQUIRED';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.platform_admin_members m
      JOIN public.platform_admin_role_assignments a ON a.user_id = m.user_id
      JOIN public.platform_role_permissions p ON p.role_key = a.role_key
      WHERE m.user_id = p_approver_id
        AND m.status = 'active'
        AND p.permission_key = 'credit.adjust.approve'
        AND (a.workspace_id IS NULL OR a.workspace_id = p_workspace_id)
    ) INTO v_approver_valid;

    IF NOT v_approver_valid THEN
      RAISE EXCEPTION 'APPROVER_PERMISSION_DENIED';
    END IF;
  END IF;

  -- 5. Row-lock on workspace_credit_states (serialize and ensure state exists)
  SELECT * INTO v_state
  FROM public.workspace_credit_states
  WHERE workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORKSPACE_CREDIT_STATE_MISSING';
  END IF;

  -- 6. Workspace-scoped idempotency check (reject conflict on amount or account)
  SELECT id, account_id, amount INTO v_existing_id, v_existing_account_id, v_existing_amount
  FROM public.credit_ledger_entries
  WHERE workspace_id = p_workspace_id AND idempotency_key = btrim(p_idempotency_key)
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_amount != p_amount OR v_existing_account_id != p_account_id THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_CONFLICT';
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'is_replay', true,
      'entry_id', v_existing_id,
      'adjusted_amount', v_existing_amount,
      'new_balance', v_state.total_available_credits,
      'message', 'Replay idempotency: previously processed.'
    );
  END IF;

  -- 7. Reject negative adjustment if insufficient total_available_credits
  IF p_amount < 0 AND (v_state.total_available_credits + p_amount::integer) < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS';
  END IF;

  -- 8. Atomic Insert into credit_ledger_entries
  INSERT INTO public.credit_ledger_entries (
    workspace_id,
    account_id,
    kind,
    action,
    amount,
    idempotency_key,
    occurred_at
  ) VALUES (
    p_workspace_id,
    p_account_id,
    'adjustment',
    NULL,
    p_amount::integer,
    btrim(p_idempotency_key),
    NOW()
  ) RETURNING id INTO v_new_entry_id;

  -- 9. Atomic Update of workspace_credit_states (only total_available_credits)
  UPDATE public.workspace_credit_states
  SET total_available_credits = total_available_credits + p_amount::integer,
      updated_at = NOW()
  WHERE workspace_id = p_workspace_id;

  v_new_balance := v_state.total_available_credits + p_amount::integer;

  -- 10. Atomic Insert into audit_events
  INSERT INTO public.audit_events (
    workspace_id,
    actor_id,
    entity_type,
    entity_id,
    event_type,
    created_at,
    metadata
  ) VALUES (
    p_workspace_id,
    p_operator_id,
    'credit_ledger',
    v_new_entry_id,
    'admin_credit_adjustment',
    NOW(),
    jsonb_build_object(
      'amount', p_amount::integer,
      'reason', btrim(p_reason),
      'idempotency_key', btrim(p_idempotency_key),
      'operator_id', p_operator_id,
      'approver_id', p_approver_id,
      'ledger_entry_id', v_new_entry_id,
      'account_id', p_account_id,
      'new_balance', v_new_balance
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'is_replay', false,
    'entry_id', v_new_entry_id,
    'adjusted_amount', p_amount::integer,
    'new_balance', v_new_balance,
    'message', 'Credit adjustment committed atomically.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_operator_credit_adjustment(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_operator_credit_adjustment(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID) TO service_role;

-- ============================================================================
-- 2. reserve_quick_post_credits: Adjustment-aware reservation
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reserve_quick_post_credits(
  p_workspace_id uuid, p_mission_id uuid, p_revision integer,
  p_scope text, p_credits integer, p_reservation_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_grant_account_id uuid;
  v_target_account_id uuid;
  v_row public.quick_post_credit_reservations%ROWTYPE;
  v_state public.workspace_credit_states%ROWTYPE;
  v_available integer;
  v_cost integer;
  v_key text;
BEGIN
  IF p_workspace_id IS NULL OR p_mission_id IS NULL OR p_reservation_id IS NULL
    OR p_revision IS NULL OR p_revision < 1 OR p_scope NOT IN ('text', 'image', 'both') THEN
    RAISE EXCEPTION 'QUICK_POST_CREDIT_INVALID' USING ERRCODE = 'P0001';
  END IF;
  v_cost := CASE p_scope WHEN 'text' THEN 100 WHEN 'image' THEN 150 ELSE 250 END;
  IF p_credits IS DISTINCT FROM v_cost THEN
    RAISE EXCEPTION 'QUICK_POST_CREDIT_INVALID' USING ERRCODE = 'P0001';
  END IF;
  v_key := 'quick-post:' || p_mission_id::text || ':' || p_revision::text || ':' || p_scope;

  -- One row lock serializes reserve/settle/release for this workspace.
  SELECT * INTO v_state FROM public.workspace_credit_states
    WHERE workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUICK_POST_CREDIT_STATE_MISSING' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_row FROM public.quick_post_credit_reservations
    WHERE workspace_id = p_workspace_id AND mission_id = p_mission_id AND revision = p_revision;
  IF FOUND THEN
    IF v_row.operation_key <> v_key OR v_row.credits <> v_cost THEN
      RAISE EXCEPTION 'QUICK_POST_CREDIT_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('reservationId', v_row.id, 'state', v_row.state,
      'requestedCredits', v_row.credits, 'isReplay', true);
  END IF;

  -- Look for signup grant account
  SELECT account.id INTO v_grant_account_id FROM public.credit_accounts AS account
    JOIN public.credit_ledger_entries AS grant_entry ON grant_entry.account_id = account.id
      AND grant_entry.workspace_id = p_workspace_id AND grant_entry.kind = 'grant'
      AND (grant_entry.idempotency_key LIKE 'signup-first-post:%' OR grant_entry.idempotency_key LIKE 'business-verified-bonus:%')
    WHERE account.workspace_id = p_workspace_id
    ORDER BY account.created_at DESC, account.id DESC LIMIT 1;

  IF v_grant_account_id IS NOT NULL THEN
    v_target_account_id := v_grant_account_id;

    -- Aggregate accepted grants, approved adjustments (admin-adj:%, bulk:%), and quick-post reserve/release/consume across workspace
    -- preserving ledger semantics and not double counting.
    -- Legacy weekly grants ('v08-%') and untracked clawbacks ('signup-clawback:%') are excluded to prevent double charge or sudden unearned spend.
    SELECT COALESCE(SUM(CASE
      WHEN kind = 'grant' AND (idempotency_key LIKE 'signup-first-post:%' OR idempotency_key LIKE 'business-verified-bonus:%') THEN amount
      WHEN kind = 'adjustment' AND (idempotency_key LIKE 'admin-adj:%' OR idempotency_key LIKE 'bulk:%') THEN amount
      WHEN kind = 'release' AND idempotency_key LIKE 'quick-post:%' THEN amount
      WHEN kind = 'consume' AND idempotency_key LIKE 'quick-post:%' THEN -amount
      WHEN kind = 'reserve' AND idempotency_key LIKE 'quick-post:%' THEN -amount
      ELSE 0 END), 0)::integer INTO v_available
      FROM public.credit_ledger_entries
      WHERE workspace_id = p_workspace_id;

    -- workspace_credit_states is authoritative cap
    v_available := GREATEST(0, LEAST(v_available, v_state.total_available_credits));
  ELSE
    -- Workspaces without signup grant: charge against the workspace balance on their most recent credit account.
    SELECT account.id INTO v_target_account_id FROM public.credit_accounts AS account
      WHERE account.workspace_id = p_workspace_id
      ORDER BY account.created_at DESC, account.id DESC LIMIT 1;
    IF v_target_account_id IS NULL THEN
      RETURN jsonb_build_object('state', 'insufficient', 'availableCredits', 0);
    END IF;
    v_available := GREATEST(0, v_state.total_available_credits);
  END IF;

  IF v_available < v_cost THEN
    RETURN jsonb_build_object('state', 'insufficient', 'availableCredits', v_available);
  END IF;

  INSERT INTO public.quick_post_credit_reservations
    (id, workspace_id, account_id, mission_id, revision, scope, credits, operation_key)
    VALUES (p_reservation_id, p_workspace_id, v_target_account_id, p_mission_id,
      p_revision, p_scope, v_cost, v_key);
  INSERT INTO public.credit_ledger_entries
    (workspace_id, account_id, reservation_id, kind, action, amount, idempotency_key)
    VALUES (p_workspace_id, v_target_account_id, NULL, 'reserve',
      'text_generation', v_cost, v_key);
  UPDATE public.workspace_credit_states
    SET total_available_credits = total_available_credits - v_cost, updated_at = now()
    WHERE workspace_id = p_workspace_id;
  RETURN jsonb_build_object('reservationId', p_reservation_id, 'state', 'reserved',
    'requestedCredits', v_cost, 'isReplay', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_quick_post_credits(uuid, uuid, integer, text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_quick_post_credits(uuid, uuid, integer, text, integer, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
