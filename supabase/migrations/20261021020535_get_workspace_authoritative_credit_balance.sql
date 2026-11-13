-- ============================================================================
-- Migration: 20261021020535_get_workspace_authoritative_credit_balance.sql
-- Description:
--   Authoritative spend balance read RPC matching reserve_quick_post_credits semantics.
--   Prevents UI display inflation when workspace_credit_states and ledger drift.
--   Enforces service-only ACL and workspace-scoped validation.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_workspace_authoritative_credit_balance(
  p_workspace_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state public.workspace_credit_states%ROWTYPE;
  v_has_signup_grant BOOLEAN := FALSE;
  v_ledger_spendable INTEGER := 0;
  v_authoritative_available INTEGER := 0;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'WORKSPACE_ID_REQUIRED';
  END IF;

  -- 1. Read workspace_credit_states (authoritative ceiling and existence check)
  SELECT * INTO v_state
  FROM public.workspace_credit_states
  WHERE workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORKSPACE_CREDIT_STATE_MISSING';
  END IF;

  -- 2. Check if workspace operates under signup grant ledger semantics
  SELECT EXISTS (
    SELECT 1
    FROM public.credit_ledger_entries
    WHERE workspace_id = p_workspace_id
      AND kind = 'grant'
      AND (
        idempotency_key LIKE 'signup-first-post:%'
        OR idempotency_key LIKE 'business-verified-bonus:%'
      )
  ) INTO v_has_signup_grant;

  IF v_has_signup_grant THEN
    -- Aggregate accepted grants, approved adjustments (admin-adj:%, bulk:%),
    -- and quick-post reserve/release/consume across workspace.
    -- Legacy weekly grants ('v08-%') and untracked clawbacks ('signup-clawback:%') are excluded.
    SELECT COALESCE(SUM(CASE
      WHEN kind = 'grant' AND (
        idempotency_key LIKE 'signup-first-post:%'
        OR idempotency_key LIKE 'business-verified-bonus:%'
      ) THEN amount
      WHEN kind = 'adjustment' AND (
        idempotency_key LIKE 'admin-adj:%'
        OR idempotency_key LIKE 'bulk:%'
      ) THEN amount
      WHEN kind = 'release' AND idempotency_key LIKE 'quick-post:%' THEN amount
      WHEN kind = 'consume' AND idempotency_key LIKE 'quick-post:%' THEN -amount
      WHEN kind = 'reserve' AND idempotency_key LIKE 'quick-post:%' THEN -amount
      ELSE 0 END), 0)::integer INTO v_ledger_spendable
    FROM public.credit_ledger_entries
    WHERE workspace_id = p_workspace_id;

    v_authoritative_available := GREATEST(0, LEAST(v_ledger_spendable, v_state.total_available_credits));
  ELSE
    -- Commercial / legacy workspaces without signup grant spend directly from total_available_credits
    v_ledger_spendable := v_state.total_available_credits;
    v_authoritative_available := GREATEST(0, v_state.total_available_credits);
  END IF;

  RETURN jsonb_build_object(
    'workspace_id', p_workspace_id,
    'authoritative_available_credits', v_authoritative_available,
    'state_total_credits', v_state.total_available_credits,
    'ledger_spendable_balance', v_ledger_spendable,
    'has_signup_grant', v_has_signup_grant,
    'updated_at', v_state.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_authoritative_credit_balance(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_authoritative_credit_balance(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
