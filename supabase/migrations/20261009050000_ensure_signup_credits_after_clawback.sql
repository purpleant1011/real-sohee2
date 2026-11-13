-- Workspaces whose signup credits were clawed back (adjustment key 'signup-clawback:<workspace_id>')
-- still hold the historical 'signup-first-post:<uid>' grant row, so the idempotent grant check would
-- wrongly treat them as already granted. Allow exactly one regrant (600) after both SNS channels connect.
CREATE OR REPLACE FUNCTION public.ensure_signup_starter_credits(p_user_id uuid, p_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  c_target_grant CONSTANT integer := 600;
  v_connected_channels integer;
  v_account_id uuid;
  v_inserted integer;
  v_key text;
  v_clawed boolean;
BEGIN
  IF p_user_id IS NULL OR p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id and p_workspace_id must not be null' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id AND wm.user_id = p_user_id AND wm.status = 'active'
  ) THEN
    RAISE EXCEPTION '사용자가 해당 워크스페이스의 활성 멤버가 아닙니다 (NOT_ACTIVE_WORKSPACE_MEMBER).'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text, 534846::bigint)
  );
  PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.business_verifications bv
    WHERE bv.workspace_id = p_workspace_id AND bv.status = 'VERIFIED'
  ) THEN
    RETURN pg_catalog.jsonb_build_object('granted', false, 'credits_granted', 0, 'already', true);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.credit_ledger_entries
    WHERE workspace_id = p_workspace_id AND kind = 'adjustment'
      AND idempotency_key = 'signup-clawback:' || p_workspace_id::text
  ) INTO v_clawed;

  IF v_clawed THEN
    v_key := 'signup-first-post:regrant:' || p_user_id::text;
  ELSE
    v_key := 'signup-first-post:' || p_user_id::text;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.credit_ledger_entries
    WHERE workspace_id = p_workspace_id AND kind = 'grant' AND idempotency_key = v_key
  ) THEN
    RETURN pg_catalog.jsonb_build_object('granted', false, 'credits_granted', 0, 'already', true);
  END IF;

  SELECT count(DISTINCT lower(cc.channel)) INTO v_connected_channels
  FROM public.channel_connections cc
  WHERE cc.workspace_id = p_workspace_id
    AND lower(cc.channel) IN ('instagram', 'threads')
    AND lower(cc.status) IN ('connected', 'verified');

  IF v_connected_channels < 2 THEN
    RETURN pg_catalog.jsonb_build_object(
      'granted', false, 'credits_granted', 0, 'already', false, 'reason', 'CHANNELS_NOT_CONNECTED'
    );
  END IF;

  SELECT id INTO v_account_id
  FROM public.credit_accounts
  WHERE workspace_id = p_workspace_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF v_account_id IS NULL THEN
    INSERT INTO public.credit_accounts (workspace_id, period_start, period_end, timezone)
    VALUES (p_workspace_id, CURRENT_DATE, (CURRENT_DATE + interval '14 days')::date, 'Asia/Seoul')
    RETURNING id INTO v_account_id;
  END IF;

  INSERT INTO public.credit_ledger_entries
    (workspace_id, account_id, kind, action, amount, idempotency_key, occurred_at)
  VALUES (p_workspace_id, v_account_id, 'grant', NULL, c_target_grant, v_key, now())
  ON CONFLICT (workspace_id, idempotency_key, kind) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN pg_catalog.jsonb_build_object('granted', false, 'credits_granted', 0, 'already', true);
  END IF;

  INSERT INTO public.trial_entitlements
    (workspace_id, plan_key, starts_at, ends_at, status, initial_credit_grant)
  VALUES (p_workspace_id, 'TRIAL_V1', now(), now() + interval '14 days', 'ACTIVE', c_target_grant)
  ON CONFLICT (workspace_id) DO UPDATE SET
    initial_credit_grant = public.trial_entitlements.initial_credit_grant + EXCLUDED.initial_credit_grant,
    updated_at = now();

  INSERT INTO public.workspace_credit_states
    (workspace_id, commercial_state, trial_started_at, trial_ends_at,
     activation_credits, agent_credits, protected_wow_credits, total_available_credits)
  VALUES (p_workspace_id, 'TRIAL_ACTIVE', now(), now() + interval '14 days',
          c_target_grant, 0, 0, c_target_grant)
  ON CONFLICT (workspace_id) DO UPDATE SET
    activation_credits = public.workspace_credit_states.activation_credits + EXCLUDED.activation_credits,
    total_available_credits = public.workspace_credit_states.total_available_credits + EXCLUDED.total_available_credits,
    updated_at = now();

  RETURN pg_catalog.jsonb_build_object('granted', true, 'credits_granted', c_target_grant, 'already', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_signup_starter_credits(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_signup_starter_credits(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
