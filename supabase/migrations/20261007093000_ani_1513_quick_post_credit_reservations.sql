-- ANI-1513. Bind quick-post charges to the signup grant account rather than the
-- unrelated v08 weekly / agent energy balances. The signup grant is the 300 SC
-- account + workspace_credit_states initialized by provision_signup_workspace.
-- Apply before deploying the application change; do not mutate production data here.
-- Rollback (after reverting app callers):
--   DROP FUNCTION IF EXISTS public.release_quick_post_credits(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.settle_quick_post_credits(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.reserve_quick_post_credits(uuid, uuid, integer, text, integer, uuid);
--   DROP TABLE IF EXISTS public.quick_post_credit_reservations;
-- Existing consume/release ledger records and prior charges must be retained, never deleted.

CREATE TABLE public.quick_post_credit_reservations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.credit_accounts(id) ON DELETE RESTRICT,
  mission_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  scope text NOT NULL CHECK (scope IN ('text', 'image', 'both')),
  credits integer NOT NULL CHECK (credits IN (100, 150, 250)),
  operation_key text NOT NULL CHECK (char_length(operation_key) BETWEEN 1 AND 200),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'settled', 'released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE (workspace_id, operation_key),
  UNIQUE (workspace_id, mission_id, revision)
);
CREATE INDEX quick_post_credit_reservations_workspace_state_idx
  ON public.quick_post_credit_reservations(workspace_id, state, created_at);
ALTER TABLE public.quick_post_credit_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quick_post_credit_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.quick_post_credit_reservations TO service_role;

CREATE FUNCTION public.reserve_quick_post_credits(
  p_workspace_id uuid, p_mission_id uuid, p_revision integer,
  p_scope text, p_credits integer, p_reservation_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_account_id uuid;
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

  -- New signups: spend the signup grant account (300 SC) and only that grant.
  SELECT account.id INTO v_account_id FROM public.credit_accounts AS account
    JOIN public.credit_ledger_entries AS grant_entry ON grant_entry.account_id = account.id
      AND grant_entry.workspace_id = p_workspace_id AND grant_entry.kind = 'grant'
      AND grant_entry.idempotency_key LIKE 'signup-first-post:%'
    WHERE account.workspace_id = p_workspace_id
    ORDER BY account.created_at DESC, account.id DESC LIMIT 1;

  IF v_account_id IS NOT NULL THEN
    SELECT COALESCE(SUM(CASE
      WHEN kind = 'grant' AND idempotency_key LIKE 'signup-first-post:%' THEN amount
      WHEN kind = 'release' AND idempotency_key LIKE 'quick-post:%' THEN amount
      WHEN kind = 'consume' AND idempotency_key LIKE 'quick-post:%' THEN -amount
      WHEN kind = 'reserve' AND idempotency_key LIKE 'quick-post:%' THEN -amount
      ELSE 0 END), 0)::integer INTO v_available
      FROM public.credit_ledger_entries
      WHERE workspace_id = p_workspace_id AND account_id = v_account_id;
    -- workspace_credit_states is also used by commercial/trial flows. Do not
    -- spend more than its available balance even if the grant ledger differs.
    v_available := GREATEST(0, LEAST(v_available, v_state.total_available_credits));
  ELSE
    -- Workspaces created before the signup grant existed (paid plans, free taste, legacy):
    -- charge against the workspace balance on their most recent credit account.
    SELECT account.id INTO v_account_id FROM public.credit_accounts AS account
      WHERE account.workspace_id = p_workspace_id
      ORDER BY account.created_at DESC, account.id DESC LIMIT 1;
    IF v_account_id IS NULL THEN
      RETURN jsonb_build_object('state', 'insufficient', 'availableCredits', 0);
    END IF;
    v_available := GREATEST(0, v_state.total_available_credits);
  END IF;
  IF v_available < v_cost THEN
    RETURN jsonb_build_object('state', 'insufficient', 'availableCredits', v_available);
  END IF;

  INSERT INTO public.quick_post_credit_reservations
    (id, workspace_id, account_id, mission_id, revision, scope, credits, operation_key)
    VALUES (p_reservation_id, p_workspace_id, v_account_id, p_mission_id,
      p_revision, p_scope, v_cost, v_key);
  INSERT INTO public.credit_ledger_entries
    (workspace_id, account_id, reservation_id, kind, action, amount, idempotency_key)
    VALUES (p_workspace_id, v_account_id, NULL, 'reserve',
      'text_generation', v_cost, v_key);
  UPDATE public.workspace_credit_states
    SET total_available_credits = total_available_credits - v_cost, updated_at = now()
    WHERE workspace_id = p_workspace_id;
  RETURN jsonb_build_object('reservationId', p_reservation_id, 'state', 'reserved',
    'requestedCredits', v_cost, 'isReplay', false);
END;
$$;

CREATE FUNCTION public.settle_quick_post_credits(
  p_workspace_id uuid, p_reservation_id uuid, p_operation_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row public.quick_post_credit_reservations%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.workspace_credit_states WHERE workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUICK_POST_CREDIT_STATE_MISSING' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_row FROM public.quick_post_credit_reservations
    WHERE id = p_reservation_id AND workspace_id = p_workspace_id AND operation_key = p_operation_key FOR UPDATE;
  IF NOT FOUND OR v_row.state = 'released' THEN
    RAISE EXCEPTION 'QUICK_POST_CREDIT_RESERVATION_STALE' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.state = 'reserved' THEN
    -- Reversing the hold and consuming the charge leaves the workspace balance
    -- unchanged after settlement. The ledger is append-only and auditable.
    INSERT INTO public.credit_ledger_entries
      (workspace_id, account_id, reservation_id, kind, action, amount, idempotency_key)
      VALUES (p_workspace_id, v_row.account_id, NULL, 'release',
        'text_generation', v_row.credits, p_operation_key || ':settle-hold');
    INSERT INTO public.credit_ledger_entries
      (workspace_id, account_id, reservation_id, kind, action, amount, idempotency_key)
      VALUES (p_workspace_id, v_row.account_id, NULL, 'consume',
        'text_generation', v_row.credits, p_operation_key || ':consume');
    UPDATE public.quick_post_credit_reservations SET state = 'settled', settled_at = now()
      WHERE id = v_row.id;
  END IF;
  RETURN jsonb_build_object('reservationId', v_row.id, 'state', 'settled');
END;
$$;

CREATE FUNCTION public.release_quick_post_credits(
  p_workspace_id uuid, p_reservation_id uuid, p_operation_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row public.quick_post_credit_reservations%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.workspace_credit_states WHERE workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUICK_POST_CREDIT_STATE_MISSING' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_row FROM public.quick_post_credit_reservations
    WHERE id = p_reservation_id AND workspace_id = p_workspace_id AND operation_key = p_operation_key FOR UPDATE;
  IF NOT FOUND OR v_row.state = 'settled' THEN
    RAISE EXCEPTION 'QUICK_POST_CREDIT_RESERVATION_STALE' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.state = 'reserved' THEN
    INSERT INTO public.credit_ledger_entries
      (workspace_id, account_id, reservation_id, kind, action, amount, idempotency_key)
      VALUES (p_workspace_id, v_row.account_id, NULL, 'release',
        'text_generation', v_row.credits, p_operation_key || ':refund');
    UPDATE public.workspace_credit_states
      SET total_available_credits = total_available_credits + v_row.credits, updated_at = now()
      WHERE workspace_id = p_workspace_id;
    UPDATE public.quick_post_credit_reservations SET state = 'released' WHERE id = v_row.id;
  END IF;
  RETURN jsonb_build_object('reservationId', v_row.id, 'state', 'released');
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_quick_post_credits(uuid, uuid, integer, text, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_quick_post_credits(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_quick_post_credits(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_quick_post_credits(uuid, uuid, integer, text, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_quick_post_credits(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_quick_post_credits(uuid, uuid, text) TO service_role;
