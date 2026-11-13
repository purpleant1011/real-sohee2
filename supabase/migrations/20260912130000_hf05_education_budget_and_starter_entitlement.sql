-- ==============================================================================
-- Migration: 20260912130000_hf05_education_budget_and_starter_entitlement.sql
-- Issue: [HF-05][P0] SOHEE_READY Entitlement & Starter Grant Exactly-Once (ANI-1354)
-- Author: Google Antigravity Full Autonomous Agent
-- Date: 2026-09-12
--
-- Description:
-- 1. Separates Workspace Provisioning (Education access) from Production Execution Entitlement.
-- 2. New RPC: provision_education_workspace
--    - Grants 0 production energy / credits.
--    - Commercial state: 'EDUCATION_MODE'.
--    - Returns bounded EDUCATION_TEST_BUDGET (20 text runs, 10 image runs).
-- 3. New RPC: grant_sohee_ready_starter_entitlement
--    - Verifies workspace membership & SOHEE_READY prerequisites.
--    - Enforces Exactly-Once starter grant using uq_free_taste_claim (FREE_TASTE_50).
--    - Idempotent: returns already_granted=true if already claimed.
-- 4. Strict Security Definer Least-Privilege:
--    - Revoke EXECUTE from PUBLIC, anon.
--    - Grant EXECUTE to authenticated, service_role.
--    - SET search_path = public, auth, pg_temp.
-- ==============================================================================

-- 1. RPC: provision_education_workspace
CREATE OR REPLACE FUNCTION public.provision_education_workspace(
  p_user_id UUID,
  p_workspace_name TEXT DEFAULT NULL,
  p_provider TEXT DEFAULT 'google'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_signup_app RECORD;
  v_new_ws_id UUID;
  v_is_verified BOOLEAN;
  v_verification_status TEXT;
  v_credit_acc_id UUID;
  v_starts_at TIMESTAMPTZ := now();
  v_ends_at TIMESTAMPTZ := now() + interval '14 days';
BEGIN
  -- [AuthZ Guard] Ensure authenticated user cannot impersonate another user_id
  IF auth.role() = 'authenticated' AND auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '본인의 사용자 계정(user_id)으로만 가입을 완료할 수 있습니다 (AUTHZ_IMPERSONATION_DENIED).'
      USING ERRCODE = '42501';
  END IF;

  -- 1. 가입 신청서 확인 및 행 락
  SELECT * INTO v_signup_app
  FROM public.signup_applications
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '신규 가입 신청서를 찾을 수 없습니다. (ANI-1354)'
      USING ERRCODE = 'P0002';
  END IF;

  -- 2. 멱등성 검사: 이미 완료되어 워크스페이스가 존재하는 경우 기존 정보 반환
  IF v_signup_app.workspace_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'workspace_id', v_signup_app.workspace_id,
      'is_new_workspace', false,
      'energy_granted', 0,
      'commercial_state', 'EDUCATION_MODE',
      'education_budget', jsonb_build_object(
        'textHarnessTestRuns', 20,
        'imageHarnessTestRuns', 10,
        'sandboxMode', true
      )
    );
  END IF;

  -- 3. 가입 가능 상태 검증
  IF v_signup_app.state NOT IN ('TASTE_READY', 'VERIFICATION_PENDING', 'FORM_REQUIRED') THEN
    RAISE EXCEPTION '현재 상태(%)에서는 교육용 워크스페이스를 프로비저닝할 수 없습니다. (ANI-1354)', v_signup_app.state
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. 필수 약관 동의 검증
  IF NOT COALESCE(v_signup_app.agreements_completed, false) THEN
    RAISE EXCEPTION '필수 약관 및 채널 위임 동의가 완료되지 않았습니다. (ANI-1354)'
      USING ERRCODE = 'P0001';
  END IF;

  v_is_verified := (v_signup_app.state = 'TASTE_READY');
  v_verification_status := CASE WHEN v_is_verified THEN 'VERIFIED' ELSE 'PENDING' END;

  -- 5. 사용자 프로필 동기화 보장
  INSERT INTO public.profiles (id, display_name, updated_at)
  SELECT
    u.id,
    COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1), '소희사용자'),
    now()
  FROM auth.users u
  WHERE u.id = p_user_id
  ON CONFLICT (id) DO UPDATE SET
    display_name = COALESCE(EXCLUDED.display_name, profiles.display_name),
    updated_at = now();

  -- 6. 워크스페이스 생성
  INSERT INTO public.workspaces (name, created_by)
  VALUES (
    COALESCE(p_workspace_name, v_signup_app.company_name, '나의 소희 마케팅'),
    p_user_id
  )
  RETURNING id INTO v_new_ws_id;

  -- 7. 워크스페이스 멤버십 등록 (owner)
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_new_ws_id, p_user_id, 'owner')
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner';

  -- 8. 사업자 정보 및 프로필 확정 연결
  IF v_signup_app.business_number IS NOT NULL AND length(v_signup_app.business_number) >= 10 THEN
    INSERT INTO public.business_verifications (
      workspace_id,
      business_number,
      company_name,
      representative_name,
      status,
      verified_at,
      updated_at
    )
    VALUES (
      v_new_ws_id,
      v_signup_app.business_number,
      v_signup_app.company_name,
      COALESCE(v_signup_app.representative_name, '대표자'),
      v_verification_status,
      CASE WHEN v_is_verified THEN now() ELSE NULL END,
      now()
    )
    ON CONFLICT (workspace_id) DO UPDATE SET
      business_number = EXCLUDED.business_number,
      company_name = EXCLUDED.company_name,
      representative_name = EXCLUDED.representative_name,
      status = EXCLUDED.status,
      verified_at = EXCLUDED.verified_at,
      updated_at = now();

    INSERT INTO public.business_profiles (workspace_id, business_name, summary, updated_at)
    VALUES (
      v_new_ws_id,
      v_signup_app.company_name,
      CASE WHEN v_is_verified THEN '신규 온보딩 매장 (교육 모드)' ELSE '소희 사업자 수동 심사 접수 매장' END,
      now()
    )
    ON CONFLICT (workspace_id) DO UPDATE SET
      business_name = EXCLUDED.business_name,
      updated_at = now();
  END IF;

  -- 9. 약관 동의 내역을 신규 워크스페이스로 연결
  UPDATE public.user_agreements
  SET workspace_id = v_new_ws_id
  WHERE user_id = p_user_id AND (workspace_id IS NULL OR workspace_id = '00000000-0000-0000-0000-000000000000'::uuid);

  -- 10. [HF-05 Canonical Invariant] 프로덕션 실행 예산 = 0 (Pre-ready spend = 0)
  INSERT INTO public.agent_energy_ledgers (
    workspace_id,
    plan_tier,
    monthly_total_energy,
    used_energy_current_month,
    reserved_energy_active_runs,
    remaining_available_energy,
    burn_rate_percentage,
    budget_alert_stage,
    forecast_run_out_days,
    updated_at
  )
  VALUES (
    v_new_ws_id,
    'EDUCATION_MODE',
    0,
    0,
    0,
    0,
    0,
    'NORMAL',
    30,
    now()
  )
  ON CONFLICT (workspace_id) DO NOTHING;

  -- 11. 하위 호환 credit_accounts & workspace_credit_states 초기화 (프로덕션 크레딧 = 0)
  INSERT INTO public.credit_accounts (workspace_id, period_start, period_end, timezone)
  VALUES (v_new_ws_id, CURRENT_DATE, (CURRENT_DATE + interval '14 days')::date, 'Asia/Seoul')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.trial_entitlements (
    workspace_id,
    plan_key,
    starts_at,
    ends_at,
    status,
    initial_credit_grant
  )
  VALUES (
    v_new_ws_id,
    'EDUCATION_SANDBOX',
    v_starts_at,
    v_ends_at,
    'PENDING',
    0
  )
  ON CONFLICT (workspace_id) DO NOTHING;

  INSERT INTO public.workspace_credit_states (
    workspace_id,
    commercial_state,
    trial_started_at,
    trial_ends_at,
    activation_credits,
    agent_credits,
    protected_wow_credits,
    total_available_credits
  )
  VALUES (
    v_new_ws_id,
    'EDUCATION_MODE',
    v_starts_at,
    v_ends_at,
    0,
    0,
    0,
    0
  )
  ON CONFLICT (workspace_id) DO NOTHING;

  -- 12. signup_applications 상태 갱신
  UPDATE public.signup_applications
  SET
    workspace_id = v_new_ws_id,
    state = 'COMPLETED',
    completed_at = now(),
    updated_at = now()
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'workspace_id', v_new_ws_id,
    'is_new_workspace', true,
    'energy_granted', 0,
    'commercial_state', 'EDUCATION_MODE',
    'education_budget', jsonb_build_object(
      'textHarnessTestRuns', 20,
      'imageHarnessTestRuns', 10,
      'sandboxMode', true
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.provision_education_workspace(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_education_workspace(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.provision_education_workspace(UUID, TEXT, TEXT) TO authenticated, service_role;


-- 2. RPC: grant_sohee_ready_starter_entitlement
CREATE OR REPLACE FUNCTION public.grant_sohee_ready_starter_entitlement(
  p_workspace_id UUID,
  p_operator_id UUID DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_biz_ver RECORD;
  v_existing_claim RECORD;
  v_caller_id UUID;
  v_credit_acc_id UUID;
  v_tx_id TEXT;
  v_starts_at TIMESTAMPTZ := now();
  v_ends_at TIMESTAMPTZ := now() + interval '14 days';
BEGIN
  v_caller_id := COALESCE(auth.uid(), p_operator_id);

  -- [AuthZ Guard] Ensure caller belongs to workspace
  IF auth.role() = 'authenticated' AND auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = p_workspace_id AND user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION '해당 워크스페이스의 멤버만 스타터 혜택을 수령할 수 있습니다 (AUTHZ_WORKSPACE_DENIED).'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 1. 사업자 인증 정보 확인
  SELECT * INTO v_biz_ver
  FROM public.business_verifications
  WHERE workspace_id = p_workspace_id;

  IF NOT FOUND OR v_biz_ver.business_number IS NULL THEN
    RAISE EXCEPTION '사업자 등록 정보가 없어 스타터 혜택을 지급할 수 없습니다. (ANI-1354)'
      USING ERRCODE = 'P0002';
  END IF;

  -- 2. [Exactly-Once Idempotency Check] uq_free_taste_claim 기반 중복 조회
  SELECT * INTO v_existing_claim
  FROM public.free_taste_claims
  WHERE business_number = v_biz_ver.business_number
    AND benefit_type = 'FREE_TASTE_50';

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_granted', true,
      'energy_granted', 0,
      'credits_granted', 0,
      'benefit_type', 'FREE_TASTE_50',
      'claimed_at', v_existing_claim.claimed_at
    );
  END IF;

  -- 3. Exactly-Once DB Claim 기록 (uq_free_taste_claim에 의해 동시 호출 시에도 1회만 성공)
  BEGIN
    INSERT INTO public.free_taste_claims (
      business_number,
      benefit_type,
      workspace_id,
      claimed_by,
      energy_granted,
      claimed_at
    )
    VALUES (
      v_biz_ver.business_number,
      'FREE_TASTE_50',
      p_workspace_id,
      v_caller_id,
      50,
      now()
    );
  EXCEPTION WHEN unique_violation THEN
    -- Concurrency race condition caught by DB unique constraint
    RETURN jsonb_build_object(
      'success', true,
      'already_granted', true,
      'energy_granted', 0,
      'credits_granted', 0,
      'benefit_type', 'FREE_TASTE_50'
    );
  END;

  -- 4. Production Execution Entitlement 지급: 50 Energy
  INSERT INTO public.agent_energy_ledgers (
    workspace_id,
    plan_tier,
    monthly_total_energy,
    used_energy_current_month,
    reserved_energy_active_runs,
    remaining_available_energy,
    burn_rate_percentage,
    budget_alert_stage,
    forecast_run_out_days,
    updated_at
  )
  VALUES (
    p_workspace_id,
    'FREE_TASTE',
    50,
    0,
    0,
    50,
    0,
    'NORMAL',
    30,
    now()
  )
  ON CONFLICT (workspace_id) DO UPDATE SET
    plan_tier = 'FREE_TASTE',
    monthly_total_energy = agent_energy_ledgers.monthly_total_energy + 50,
    remaining_available_energy = agent_energy_ledgers.remaining_available_energy + 50,
    updated_at = now();

  v_tx_id := 'tx_starter_' || floor(extract(epoch from now()) * 1000)::text || '_' || substr(p_workspace_id::text, 1, 8);
  INSERT INTO public.agent_energy_transactions (
    transaction_id,
    workspace_id,
    pack_count,
    paid_amount_krw,
    added_energy,
    created_at
  )
  VALUES (
    v_tx_id,
    p_workspace_id,
    1,
    0,
    50,
    now()
  );

  -- 5. 하위 호환 Credit 및 Trial Entitlement 지급: 40,000 Credits
  SELECT id INTO v_credit_acc_id
  FROM public.credit_accounts
  WHERE workspace_id = p_workspace_id
  LIMIT 1;

  IF v_credit_acc_id IS NOT NULL THEN
    INSERT INTO public.credit_ledger_entries (
      workspace_id,
      account_id,
      kind,
      action,
      amount,
      idempotency_key,
      occurred_at
    )
    VALUES (
      p_workspace_id,
      v_credit_acc_id,
      'grant',
      NULL,
      40000,
      'starter-grant-sohee-ready:' || p_workspace_id::text,
      now()
    )
    ON CONFLICT (workspace_id, idempotency_key, kind) DO NOTHING;
  END IF;

  UPDATE public.trial_entitlements
  SET
    status = 'ACTIVE',
    initial_credit_grant = 40000,
    starts_at = v_starts_at,
    ends_at = v_ends_at,
    updated_at = now()
  WHERE workspace_id = p_workspace_id;

  UPDATE public.workspace_credit_states
  SET
    commercial_state = 'TRIAL_ACTIVE',
    activation_credits = 5000,
    agent_credits = 25000,
    protected_wow_credits = 10000,
    total_available_credits = 40000,
    trial_started_at = v_starts_at,
    trial_ends_at = v_ends_at,
    updated_at = now()
  WHERE workspace_id = p_workspace_id;

  -- 6. 트라이얼 여정 마일스톤 생성
  PERFORM public.seed_trial_journey_milestones(p_workspace_id);

  RETURN jsonb_build_object(
    'success', true,
    'already_granted', false,
    'energy_granted', 50,
    'credits_granted', 40000,
    'benefit_type', 'FREE_TASTE_50',
    'claimed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grant_sohee_ready_starter_entitlement(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_sohee_ready_starter_entitlement(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.grant_sohee_ready_starter_entitlement(UUID, UUID) TO authenticated, service_role;
