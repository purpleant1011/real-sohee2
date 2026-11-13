-- Forward-only policy: no credit on signup, 600 once both SNS channels connect,
-- and 1,000 additional credits once per workspace on business verification.
-- Previously granted 1,000 or legacy balances are deliberately not reclaimed.

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

  -- Serialize checks and grants for the workspace, including retrying OAuth callbacks.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text, 534846::bigint)
  );
  -- Share a row lock with verification so approval and signup grants have one ordering.
  PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.business_verifications bv
    WHERE bv.workspace_id = p_workspace_id AND bv.status = 'VERIFIED'
  ) THEN
    RETURN pg_catalog.jsonb_build_object('granted', false, 'credits_granted', 0, 'already', true);
  END IF;

  v_key := 'signup-first-post:' || p_user_id::text;
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
COMMENT ON FUNCTION public.ensure_signup_starter_credits(uuid, uuid) IS
  'Once per user and workspace, grant 600 first-post credits only after Instagram and Threads are connected; never top up or reclaim historical grants.';

CREATE OR REPLACE FUNCTION public.provision_signup_workspace(
  p_user_id uuid,
  p_provider text DEFAULT 'google'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_app public.signup_applications%ROWTYPE;
  v_ws_id uuid;
  v_account_id uuid;
  v_name text;
BEGIN
  -- SECURITY DEFINER bypasses RLS; authenticated callers can only provision themselves.
  IF (SELECT auth.role()) = 'authenticated' AND (SELECT auth.uid()) IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION '본인의 사용자 계정으로만 가입할 수 있습니다 (AUTHZ_IMPERSONATION_DENIED).'
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR COALESCE((SELECT auth.role()), '') NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION '가입을 위한 인증이 필요합니다.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 534845::bigint)
  );
  INSERT INTO public.signup_applications (user_id, state, agreements_completed)
  VALUES (p_user_id, 'FORM_REQUIRED', false)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_app FROM public.signup_applications WHERE user_id = p_user_id FOR UPDATE;

  IF v_app.workspace_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = v_app.workspace_id AND wm.user_id = p_user_id AND wm.status = 'active'
  ) THEN
    RETURN pg_catalog.jsonb_build_object('success', true, 'workspace_id', v_app.workspace_id,
      'is_new_workspace', false, 'credits_granted', 0, 'energy_granted', 0);
  END IF;

  SELECT wm.workspace_id INTO v_ws_id
  FROM public.workspace_members wm WHERE wm.user_id = p_user_id AND wm.status = 'active'
  ORDER BY wm.created_at, wm.workspace_id LIMIT 1;
  IF v_ws_id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('success', true, 'workspace_id', v_ws_id,
      'is_new_workspace', false, 'credits_granted', 0, 'energy_granted', 0);
  END IF;

  IF v_app.state <> 'FORM_REQUIRED' OR v_app.business_number IS NOT NULL THEN
    RAISE EXCEPTION '기존 가입 절차를 계속 진행해 주세요. (SIGNUP_IN_PROGRESS)'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT pg_catalog.left(COALESCE(NULLIF(pg_catalog.btrim(u.raw_user_meta_data->>'full_name'), ''),
                  NULLIF(pg_catalog.btrim(u.raw_user_meta_data->>'name'), ''),
                  NULLIF(pg_catalog.split_part(u.email, '@', 1), ''), '사장님'), 60)
    INTO v_name FROM auth.users u WHERE u.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '인증된 사용자를 찾을 수 없습니다.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.profiles (id, display_name, updated_at)
  VALUES (p_user_id, v_name, now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.workspaces (name, created_by)
  VALUES (v_name || '의 워크스페이스', p_user_id)
  RETURNING id INTO v_ws_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_ws_id, p_user_id, 'owner')
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner';

  -- No grant ledger until BOTH channels are connected.
  INSERT INTO public.credit_accounts (workspace_id, period_start, period_end, timezone)
  VALUES (v_ws_id, CURRENT_DATE, (CURRENT_DATE + interval '14 days')::date, 'Asia/Seoul')
  RETURNING id INTO v_account_id;

  INSERT INTO public.trial_entitlements
    (workspace_id, plan_key, starts_at, ends_at, status, initial_credit_grant)
  VALUES (v_ws_id, 'TRIAL_V1', now(), now() + interval '14 days', 'ACTIVE', 0)
  ON CONFLICT (workspace_id) DO NOTHING;

  INSERT INTO public.workspace_credit_states
    (workspace_id, commercial_state, trial_started_at, trial_ends_at,
     activation_credits, agent_credits, protected_wow_credits, total_available_credits)
  VALUES (v_ws_id, 'TRIAL_ACTIVE', now(), now() + interval '14 days', 0, 0, 0, 0)
  ON CONFLICT (workspace_id) DO NOTHING;

  INSERT INTO public.agent_energy_ledgers
    (workspace_id, plan_tier, monthly_total_energy, used_energy_current_month,
     reserved_energy_active_runs, remaining_available_energy, burn_rate_percentage,
     budget_alert_stage, forecast_run_out_days, updated_at)
  VALUES (v_ws_id, 'FREE_TASTE', 0, 0, 0, 0, 0, 'NORMAL', 30, now())
  ON CONFLICT (workspace_id) DO NOTHING;

  UPDATE public.signup_applications
  SET workspace_id = v_ws_id, state = 'COMPLETED', completed_at = now(), updated_at = now()
  WHERE user_id = p_user_id;

  RETURN pg_catalog.jsonb_build_object('success', true, 'workspace_id', v_ws_id,
    'is_new_workspace', true, 'credits_granted', 0, 'energy_granted', 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.provision_signup_workspace(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_signup_workspace(uuid, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.provision_signup_workspace(uuid, text) IS
  'Create one zero-credit workspace per new auth user; first-post credits are deferred until both SNS channels connect.';

CREATE OR REPLACE FUNCTION public.admin_verify_business_and_grant_taste(
  p_workspace_id uuid,
  p_operator_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_bv public.business_verifications%ROWTYPE;
  v_ws public.workspaces%ROWTYPE;
  v_account_id uuid;
  v_inserted integer := 0;
  v_credits_granted integer := 0;
  v_already_granted boolean := false;
BEGIN
  -- The only RPC caller is service_role, reached after requireOperator workspace scope checks.
  -- Keep the legacy platform-admin guard as defense in depth if privileges ever change.
  IF (SELECT auth.role()) = 'authenticated' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.platform_admin_members WHERE user_id = (SELECT auth.uid())
    ) THEN
      RAISE EXCEPTION '플랫폼 관리자 권한이 필요합니다 (ADMIN_ROLE_REQUIRED).'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_status NOT IN ('VERIFIED', 'REJECTED', 'PENDING', 'DOCUMENT_REQUIRED', 'MISMATCH') THEN
    RAISE EXCEPTION '유효한 심사 상태가 필요합니다. (status: %)', p_status
      USING ERRCODE = 'P0001';
  END IF;

  -- Lock the workspace first so simultaneous approvals cannot race account initialization.
  SELECT * INTO v_ws FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '워크스페이스를 찾을 수 없습니다. (id: %)', p_workspace_id
      USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_bv FROM public.business_verifications
  WHERE workspace_id = p_workspace_id FOR UPDATE;

  IF p_status = 'VERIFIED' THEN
    IF v_bv.business_number IS NULL OR v_bv.business_number = '0000000000'
       OR length(v_bv.business_number) < 10 THEN
      RAISE EXCEPTION '유효한 사업자등록번호가 없어 VERIFIED 승인이 불가합니다. (ANI-603)'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_bv.company_name IS NULL OR v_bv.company_name = '심사 대상 매장' THEN
      RAISE EXCEPTION '유효한 상호명이 확인되지 않아 VERIFIED 승인이 불가합니다. (ANI-603)'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT id INTO v_account_id FROM public.credit_accounts
    WHERE workspace_id = p_workspace_id ORDER BY created_at DESC, id DESC LIMIT 1;
    IF v_account_id IS NULL THEN
      INSERT INTO public.credit_accounts (workspace_id, period_start, period_end, timezone)
      VALUES (p_workspace_id, CURRENT_DATE, (CURRENT_DATE + interval '14 days')::date, 'Asia/Seoul')
      RETURNING id INTO v_account_id;
    END IF;

    INSERT INTO public.credit_ledger_entries
      (workspace_id, account_id, kind, action, amount, idempotency_key, occurred_at)
    VALUES (p_workspace_id, v_account_id, 'grant', NULL, 1000,
            'business-verified-bonus:' || p_workspace_id::text, now())
    ON CONFLICT (workspace_id, idempotency_key, kind) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_credits_granted := v_inserted * 1000;
    v_already_granted := v_inserted = 0;

    IF v_inserted = 1 THEN
      -- Leave existing commercial and trial statuses untouched; never overwrite a balance.
      INSERT INTO public.trial_entitlements
        (workspace_id, plan_key, starts_at, ends_at, status, initial_credit_grant)
      VALUES (p_workspace_id, 'TRIAL_V1', now(), now() + interval '14 days', 'ACTIVE', 1000)
      ON CONFLICT (workspace_id) DO UPDATE SET
        initial_credit_grant = public.trial_entitlements.initial_credit_grant + EXCLUDED.initial_credit_grant,
        updated_at = now();

      INSERT INTO public.workspace_credit_states
        (workspace_id, commercial_state, trial_started_at, trial_ends_at,
         activation_credits, agent_credits, protected_wow_credits, total_available_credits)
      VALUES (p_workspace_id, 'TRIAL_ACTIVE', now(), now() + interval '14 days', 1000, 0, 0, 1000)
      ON CONFLICT (workspace_id) DO UPDATE SET
        activation_credits = public.workspace_credit_states.activation_credits + EXCLUDED.activation_credits,
        total_available_credits = public.workspace_credit_states.total_available_credits + EXCLUDED.total_available_credits,
        updated_at = now();
    END IF;

    IF v_ws.created_by IS NOT NULL THEN
      UPDATE public.signup_applications
      SET state = 'COMPLETED', completed_at = now(), updated_at = now()
      WHERE user_id = v_ws.created_by AND state = 'VERIFICATION_PENDING';
    END IF;
  END IF;

  UPDATE public.business_verifications
  SET status = p_status,
      rejection_reason = CASE WHEN p_status = 'REJECTED' THEN p_reason ELSE NULL END,
      verified_at = CASE WHEN p_status = 'VERIFIED' THEN now() ELSE NULL END,
      updated_at = now()
  WHERE workspace_id = p_workspace_id;

  INSERT INTO public.audit_events
    (workspace_id, entity_type, entity_id, event_type, metadata)
  VALUES (p_workspace_id, 'business_verification', p_workspace_id,
    'admin_business_verification_status_change',
    pg_catalog.jsonb_build_object(
      'operator_id', p_operator_id, 'new_status', p_status,
      'business_number', v_bv.business_number, 'company_name', v_bv.company_name,
      'reason', COALESCE(p_reason, '운영자 직접 심사 처리'),
      'energy_granted', 0, 'credits_granted', v_credits_granted,
      'already_granted', v_already_granted
    ));

  RETURN pg_catalog.jsonb_build_object(
    'success', true, 'workspace_id', p_workspace_id, 'status', p_status,
    'energy_granted', 0, 'credits_granted', v_credits_granted,
    'already_granted', v_already_granted
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_verify_business_and_grant_taste(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_verify_business_and_grant_taste(uuid, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_quick_post_credits(
  p_workspace_id uuid, p_mission_id uuid, p_revision integer,
  p_scope text, p_credits integer, p_reservation_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
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
      AND (grant_entry.idempotency_key LIKE 'signup-first-post:%' OR grant_entry.idempotency_key LIKE 'business-verified-bonus:%')
    WHERE account.workspace_id = p_workspace_id
    ORDER BY account.created_at DESC, account.id DESC LIMIT 1;

  IF v_account_id IS NOT NULL THEN
    SELECT COALESCE(SUM(CASE
      WHEN kind = 'grant' AND (idempotency_key LIKE 'signup-first-post:%' OR idempotency_key LIKE 'business-verified-bonus:%') THEN amount
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
$function$;

REVOKE ALL ON FUNCTION public.reserve_quick_post_credits(uuid, uuid, integer, text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_quick_post_credits(uuid, uuid, integer, text, integer, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
