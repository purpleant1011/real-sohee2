-- ANI-1580 / ANI-1505c: Ensure all signups receive 1,000 SC (two complete 250 SC first-posts: IG + Threads text + image)
-- and establish membership tier gating (FORMAL vs TRIAL).
-- 1) Constant 1,000 SC starter grant function for idempotency and backfill.
-- 2) Update provision_signup_workspace from 600 SC to 1,000 SC.
-- 3) One-time safe backfill for production workspaces lacking the grant or on 600 SC.
-- 4) Fast authoritative get_workspace_membership_tier RPC.

-- 1. ensure_signup_starter_credits
CREATE OR REPLACE FUNCTION public.ensure_signup_starter_credits(
  p_user_id uuid,
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  c_target_grant CONSTANT integer := 1000;
  v_base_key text;
  v_topup_key text;
  v_has_base boolean := false;
  v_has_topup boolean := false;
  v_base_amount integer := 0;
  v_grant_amount integer := 0;
  v_key text;
  v_account_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id and p_workspace_id must not be null' USING ERRCODE = 'P0001';
  END IF;

  -- 활성 멤버 확인 (SECURITY DEFINER 가드)
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = p_user_id
      AND wm.status = 'active'
  ) THEN
    RAISE EXCEPTION '사용자가 해당 워크스페이스의 활성 멤버가 아닙니다 (NOT_ACTIVE_WORKSPACE_MEMBER).'
      USING ERRCODE = '42501';
  END IF;

  -- 워크스페이스 단위 직렬화
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text, 534846::bigint)
  );

  -- 정식회원(사업자 인증 승인)은 정식 크레딧 체계를 쓰므로 체험 지급 대상이 아니다.
  IF EXISTS (
    SELECT 1 FROM public.business_verifications bv
    WHERE bv.workspace_id = p_workspace_id AND bv.status = 'VERIFIED'
  ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'granted', false,
      'credits_granted', 0,
      'already', true
    );
  END IF;

  v_base_key := 'signup-first-post:' || p_user_id::text;
  v_topup_key := 'signup-first-post:topup:' || p_user_id::text;

  -- 기존 grant 원장 확인
  SELECT amount INTO v_base_amount
  FROM public.credit_ledger_entries
  WHERE workspace_id = p_workspace_id
    AND kind = 'grant'
    AND idempotency_key = v_base_key
  LIMIT 1;

  IF FOUND THEN
    v_has_base := true;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.credit_ledger_entries
    WHERE workspace_id = p_workspace_id
      AND kind = 'grant'
      AND idempotency_key = v_topup_key
  ) INTO v_has_topup;

  -- 지급 대상 및 금액 산출
  IF NOT v_has_base THEN
    v_grant_amount := c_target_grant;
    v_key := v_base_key;
  ELSIF v_base_amount = 600 AND NOT v_has_topup THEN
    v_grant_amount := 400;
    v_key := v_topup_key;
  ELSIF v_base_amount < c_target_grant AND NOT v_has_topup THEN
    v_grant_amount := c_target_grant - v_base_amount;
    v_key := v_topup_key;
  ELSE
    RETURN pg_catalog.jsonb_build_object(
      'granted', false,
      'credits_granted', 0,
      'already', true
    );
  END IF;

  IF v_grant_amount <= 0 THEN
    RETURN pg_catalog.jsonb_build_object(
      'granted', false,
      'credits_granted', 0,
      'already', true
    );
  END IF;

  -- credit_accounts 없으면 생성
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

  -- 원장 기록 (멱등: on conflict do nothing)
  INSERT INTO public.credit_ledger_entries
    (workspace_id, account_id, kind, action, amount, idempotency_key, occurred_at)
  VALUES
    (p_workspace_id, v_account_id, 'grant', NULL, v_grant_amount, v_key, now())
  ON CONFLICT (workspace_id, idempotency_key, kind) DO NOTHING;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'granted', false,
      'credits_granted', 0,
      'already', true
    );
  END IF;

  -- trial_entitlements 없으면 생성
  INSERT INTO public.trial_entitlements
    (workspace_id, plan_key, starts_at, ends_at, status, initial_credit_grant)
  VALUES (p_workspace_id, 'TRIAL_V1', now(), now() + interval '14 days', 'ACTIVE', c_target_grant)
  ON CONFLICT (workspace_id) DO NOTHING;

  -- workspace_credit_states 합계 갱신 (0크레딧 교육모드 워크스페이스 포함)
  INSERT INTO public.workspace_credit_states
    (workspace_id, commercial_state, trial_started_at, trial_ends_at,
     activation_credits, agent_credits, protected_wow_credits, total_available_credits)
  VALUES (p_workspace_id, 'TRIAL_ACTIVE', now(), now() + interval '14 days',
          v_grant_amount, 0, 0, v_grant_amount)
  ON CONFLICT (workspace_id) DO UPDATE SET
    activation_credits = public.workspace_credit_states.activation_credits + EXCLUDED.activation_credits,
    total_available_credits = public.workspace_credit_states.total_available_credits + EXCLUDED.total_available_credits,
    updated_at = now();

  RETURN pg_catalog.jsonb_build_object(
    'granted', true,
    'credits_granted', v_grant_amount,
    'already', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_signup_starter_credits(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_signup_starter_credits(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public.ensure_signup_starter_credits(uuid, uuid) IS
  'ANI-1580: Idempotently ensure 1,000 SC starter credits for a workspace member, granting 1,000 or topping up 400 if 600 was previously granted.';

-- 2. provision_signup_workspace (1,000 SC)
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
  -- SECURITY DEFINER는 RLS를 우회한다. authenticated는 반드시 본인 ID만 사용할 수 있다.
  IF (SELECT auth.role()) = 'authenticated' AND (SELECT auth.uid()) IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION '본인의 사용자 계정으로만 가입할 수 있습니다 (AUTHZ_IMPERSONATION_DENIED).'
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR COALESCE((SELECT auth.role()), '') NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION '가입을 위한 인증이 필요합니다.' USING ERRCODE = '42501';
  END IF;

  -- 기존 가입/워크스페이스는 그대로 사용한다. 동일 사용자 가입 RPC 호출을 먼저 직렬화한다.
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
    -- 기존에 완료된 신청은 상태/사업자 정보/혜택을 변경하지 않고 반환한다.
    RETURN pg_catalog.jsonb_build_object('success', true, 'workspace_id', v_app.workspace_id,
      'is_new_workspace', false, 'credits_granted', 0, 'energy_granted', 0);
  END IF;

  SELECT wm.workspace_id INTO v_ws_id
  FROM public.workspace_members wm WHERE wm.user_id = p_user_id AND wm.status = 'active'
  ORDER BY wm.created_at, wm.workspace_id LIMIT 1;
  IF v_ws_id IS NOT NULL THEN
    -- 기존 워크스페이스만 존재하는 가입자도 재지급 없이 반환한다.
    RETURN pg_catalog.jsonb_build_object('success', true, 'workspace_id', v_ws_id,
      'is_new_workspace', false, 'credits_granted', 0, 'energy_granted', 0);
  END IF;

  -- 기존 사업자 인증 진행 중인 신청은 기존 절차를 유지한다. 신규 번호 없는 가입만 대상이다.
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

  -- A workspace trigger may already have added the creator as owner; make this idempotent.
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_ws_id, p_user_id, 'owner')
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner';

  -- 1,000 SC는 별도 원장 키와 signup_applications.user_id 유니크로 사용자당 한 번만 지급한다.
  -- 사업자번호가 없으므로 FREE_TASTE_50 claim이나 50 Energy는 생성하지 않는다.
  INSERT INTO public.credit_accounts (workspace_id, period_start, period_end, timezone)
  VALUES (v_ws_id, CURRENT_DATE, (CURRENT_DATE + interval '14 days')::date, 'Asia/Seoul')
  RETURNING id INTO v_account_id;

  INSERT INTO public.credit_ledger_entries
    (workspace_id, account_id, kind, action, amount, idempotency_key, occurred_at)
  VALUES (v_ws_id, v_account_id, 'grant', NULL, 1000, 'signup-first-post:' || p_user_id::text, now());

  INSERT INTO public.trial_entitlements
    (workspace_id, plan_key, starts_at, ends_at, status, initial_credit_grant)
  VALUES (v_ws_id, 'TRIAL_V1', now(), now() + interval '14 days', 'ACTIVE', 1000)
  ON CONFLICT (workspace_id) DO NOTHING;

  INSERT INTO public.workspace_credit_states
    (workspace_id, commercial_state, trial_started_at, trial_ends_at,
     activation_credits, agent_credits, protected_wow_credits, total_available_credits)
  VALUES (v_ws_id, 'TRIAL_ACTIVE', now(), now() + interval '14 days', 1000, 0, 0, 1000)
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
    'is_new_workspace', true, 'credits_granted', 1000, 'energy_granted', 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.provision_signup_workspace(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_signup_workspace(uuid, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.provision_signup_workspace(uuid, text) IS
  'ANI-1505c: one workspace and 1,000 first-post SC per new auth user, without a business number or free taste claim.';

-- 3. One-time safe backfill for production workspaces lacking the grant or having only 600 SC
DO $$
DECLARE
  ws record;
  v_owner_id uuid;
  v_res jsonb;
BEGIN
  FOR ws IN
    SELECT w.id AS workspace_id, w.created_by
    FROM public.workspaces w
    LEFT JOIN public.workspace_lifecycles l ON l.workspace_id = w.id
    WHERE w.workspace_kind = 'production'
      AND w.name NOT LIKE '%쇼케이스%'
      AND (l.status IS NULL OR l.status IS DISTINCT FROM 'terminated')
  LOOP
    -- 소유자 확인: workspaces.created_by 또는 workspace_members 활성 owner
    v_owner_id := ws.created_by;
    IF v_owner_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = ws.workspace_id AND wm.user_id = v_owner_id AND wm.status = 'active'
    ) THEN
      SELECT wm.user_id INTO v_owner_id
      FROM public.workspace_members wm
      WHERE wm.workspace_id = ws.workspace_id AND wm.status = 'active' AND wm.role = 'owner'
      ORDER BY wm.created_at ASC LIMIT 1;
    END IF;

    -- 활성 owner가 없으면 임의의 활성 멤버
    IF v_owner_id IS NULL THEN
      SELECT wm.user_id INTO v_owner_id
      FROM public.workspace_members wm
      WHERE wm.workspace_id = ws.workspace_id AND wm.status = 'active'
      ORDER BY wm.created_at ASC LIMIT 1;
    END IF;

    IF v_owner_id IS NOT NULL THEN
      v_res := public.ensure_signup_starter_credits(v_owner_id, ws.workspace_id);
    END IF;
  END LOOP;
END;
$$;

-- 4. get_workspace_membership_tier RPC
CREATE OR REPLACE FUNCTION public.get_workspace_membership_tier(p_workspace_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  IF p_workspace_id IS NULL THEN
    RETURN 'TRIAL';
  END IF;

  SELECT status INTO v_status
  FROM public.business_verifications
  WHERE workspace_id = p_workspace_id
  ORDER BY updated_at DESC, created_at DESC
  LIMIT 1;

  IF NOT FOUND OR v_status IS NULL THEN
    RETURN 'TRIAL';
  END IF;

  CASE v_status
    WHEN 'VERIFIED' THEN
      RETURN 'FORMAL';
    WHEN 'REJECTED' THEN
      RETURN 'REJECTED';
    WHEN 'PENDING', 'DOCUMENT_REQUIRED', 'MISMATCH' THEN
      RETURN 'PENDING_REVIEW';
    ELSE
      RETURN 'TRIAL';
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_membership_tier(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_membership_tier(uuid) TO service_role;
COMMENT ON FUNCTION public.get_workspace_membership_tier(uuid) IS
  'ANI-1580: Fast membership tier lookup (FORMAL, REJECTED, PENDING_REVIEW, TRIAL) for service_role.';
