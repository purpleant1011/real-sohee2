-- ============================================================================
-- Migration: 20260903090000_atomic_credit_adjustment_dual_control.sql
-- Issues:
--   [ANI-639] [ADM-507] Admin Credit Adjustment 2인 결재(Dual Control) 및 DB RPC 원자화
-- Description:
--   1. apply_operator_credit_adjustment RPC:
--      - Single DB Transaction guaranteeing atomicity across ledger + audit
--      - Workspace-scoped idempotency key check
--      - True Dual Control approver verification (distinct operator, active, permission)
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
  v_existing_amount NUMERIC;
  v_new_entry_id UUID;
  v_new_balance NUMERIC;
  v_approver_valid BOOLEAN := FALSE;
BEGIN
  -- 1. Validate inputs
  IF p_workspace_id IS NULL OR p_account_id IS NULL OR p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'INVALID_CREDIT_ADJUSTMENT_INPUT';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  -- 2. Workspace-scoped idempotency check
  SELECT id, amount INTO v_existing_id, v_existing_amount
  FROM public.credit_ledger_entries
  WHERE workspace_id = p_workspace_id AND idempotency_key = btrim(p_idempotency_key)
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_new_balance
    FROM public.credit_ledger_entries
    WHERE workspace_id = p_workspace_id;

    RETURN jsonb_build_object(
      'success', true,
      'is_replay', true,
      'entry_id', v_existing_id,
      'adjusted_amount', v_existing_amount,
      'new_balance', v_new_balance,
      'message', 'Replay idempotency: previously processed.'
    );
  END IF;

  -- 3. Dual Control for High-Value (> 50,000 SC)
  IF ABS(p_amount) > 50000 THEN
    IF p_approver_id IS NULL OR p_approver_id = p_operator_id THEN
      RAISE EXCEPTION 'DUAL_CONTROL_APPROVER_REQUIRED';
    END IF;

    -- Verify approver is an active platform admin with credit adjust approve permission
    SELECT EXISTS (
      SELECT 1
      FROM public.platform_admin_members m
      JOIN public.platform_admin_role_assignments a ON a.user_id = m.user_id
      JOIN public.platform_role_permissions p ON p.role_key = a.role_key
      WHERE m.user_id = p_approver_id
        AND m.status = 'active'
        AND p.permission_key = 'credit.adjust.approve'
    ) INTO v_approver_valid;

    IF NOT v_approver_valid THEN
      RAISE EXCEPTION 'APPROVER_PERMISSION_DENIED';
    END IF;
  END IF;

  -- 4. Atomic Insert into credit_ledger_entries
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
    p_amount,
    btrim(p_idempotency_key),
    NOW()
  ) RETURNING id INTO v_new_entry_id;

  -- 5. Atomic Insert into audit_events
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
      'amount', p_amount,
      'reason', btrim(p_reason),
      'idempotency_key', btrim(p_idempotency_key),
      'operator_id', p_operator_id,
      'approver_id', p_approver_id,
      'ledger_entry_id', v_new_entry_id
    )
  );

  -- 6. Read back authoritative balance
  SELECT COALESCE(SUM(amount), 0) INTO v_new_balance
  FROM public.credit_ledger_entries
  WHERE workspace_id = p_workspace_id;

  RETURN jsonb_build_object(
    'success', true,
    'is_replay', false,
    'entry_id', v_new_entry_id,
    'adjusted_amount', p_amount,
    'new_balance', v_new_balance,
    'message', 'Credit adjustment committed atomically.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_operator_credit_adjustment(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_operator_credit_adjustment(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID) TO service_role;
