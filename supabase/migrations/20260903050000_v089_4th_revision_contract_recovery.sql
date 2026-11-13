-- ============================================================================
-- Migration: 20260903050000_v089_4th_revision_contract_recovery.sql
-- Epic: ANI-594 (V0.8.9 4차 Production Contract Recovery)
-- Covers: ANI-595, ANI-596, ANI-599, ANI-601, ANI-612
-- ============================================================================

-- 1. [ANI-599] Kill Switch CHANNEL scope constraint & (scope, target_id) UNIQUE constraint
DO $$ BEGIN
  ALTER TABLE public.kill_switches DROP CONSTRAINT IF EXISTS kill_switches_scope_check;
  ALTER TABLE public.kill_switches ADD CONSTRAINT kill_switches_scope_check 
    CHECK (scope = ANY (ARRAY['GLOBAL'::text, 'WORKSPACE'::text, 'PROVIDER'::text, 'CHANNEL'::text]));
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_kill_switches_scope_target'
  ) THEN
    ALTER TABLE public.kill_switches ADD CONSTRAINT uq_kill_switches_scope_target UNIQUE (scope, target_id);
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 2. [ANI-612] Performance Advisor: external_action_receipts 중복 permissive 정책 제거
DROP POLICY IF EXISTS "external_action_receipts_select" ON public.external_action_receipts;

-- 3. [ANI-596 / ANI-603] bootstrap_workspace_trial 보안 및 계약 엄격화
CREATE OR REPLACE FUNCTION public.bootstrap_workspace_trial(
  p_user_id UUID,
  p_provider TEXT DEFAULT 'google',
  p_workspace_name TEXT DEFAULT '나의 소희 마케팅'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_existing_ws_id UUID;
  v_new_ws_id UUID;
  v_credit_acc_id UUID;
  v_signup_app RECORD;
  v_starts_at TIMESTAMPTZ := now();
  v_ends_at TIMESTAMPTZ := now() + interval '14 days';
BEGIN
  -- A. 호출자 identity 검증 (Service Role이 아니면서 auth.uid()가 파라미터와 다르면 거부)
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '호출자 인증 식별자가 일치하지 않습니다. (BOLA 방어)';
  END IF;

  -- B. 멱등성 검사: 이미 워크스페이스가 존재하는 사용자인 경우
  SELECT workspace_id INTO v_existing_ws_id
  FROM public.workspace_members
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_existing_ws_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'workspace_id', v_existing_ws_id,
      'is_new_trial', false,
      'message', 'Existing workspace returned (idempotent)'
    );
  END IF;

  -- C. Invariant 검증: signup_applications 상태 및 약관 완료 검사
  SELECT * INTO v_signup_app
  FROM public.signup_applications
  WHERE user_id = p_user_id;

  IF v_signup_app IS NULL THEN
    RAISE EXCEPTION '신규 회원가입 신청서(signup_applications)가 존재하지 않습니다.';
  END IF;

  IF v_signup_app.state NOT IN ('TRIAL_READY', 'COMPLETED') THEN
    RAISE EXCEPTION '가입 상태(%)가 TRIAL_READY가 아니므로 트라이얼을 활성화할 수 없습니다.', v_signup_app.state;
  END IF;

  IF NOT v_signup_app.agreements_completed THEN
    RAISE EXCEPTION '필수 법적 약관 및 위임 동의가 완료되지 않았습니다.';
  END IF;

  -- D. 플레이스홀더 사업자 정보 거부 (ANI-603)
  IF v_signup_app.business_number IS NULL OR v_signup_app.business_number = '0000000000' OR v_signup_app.company_name IS NULL THEN
    RAISE EXCEPTION '유효한 사업자 인증 정보(business_number, company_name)가 필요합니다.';
  END IF;

  -- E. 1단계: 워크스페이스 생성
  INSERT INTO public.workspaces (name, created_by)
  VALUES (COALESCE(p_workspace_name, '나의 소희 마케팅'), p_user_id)
  RETURNING id INTO v_new_ws_id;

  -- F. 2단계: 워크스페이스 멤버십 등록 (소유자)
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_new_ws_id, p_user_id, 'owner');

  -- G. 3단계: 사업자 정보 확정 연결 (business_verifications & business_profiles)
  INSERT INTO public.business_verifications (
    workspace_id,
    business_number,
    company_name,
    representative_name,
    status,
    verified_at
  )
  VALUES (
    v_new_ws_id,
    v_signup_app.business_number,
    v_signup_app.company_name,
    COALESCE(v_signup_app.representative_name, '대표자'),
    'VERIFIED',
    now()
  )
  ON CONFLICT (workspace_id) DO UPDATE SET
    business_number = EXCLUDED.business_number,
    company_name = EXCLUDED.company_name,
    representative_name = EXCLUDED.representative_name,
    status = 'VERIFIED',
    verified_at = now();

  INSERT INTO public.business_profiles (workspace_id, business_name, summary, updated_at)
  VALUES (v_new_ws_id, v_signup_app.company_name, '신규 정식 가입 매장', now())
  ON CONFLICT (workspace_id) DO UPDATE SET
    business_name = EXCLUDED.business_name,
    updated_at = now();

  -- H. 4단계: pre-workspace 약관 동의 내역을 신규 워크스페이스로 원자적 연결
  UPDATE public.user_agreements
  SET workspace_id = v_new_ws_id
  WHERE user_id = p_user_id AND (workspace_id IS NULL OR workspace_id = '00000000-0000-0000-0000-000000000000'::uuid);

  -- I. 5단계: 크레딧 계좌 및 14일 40,000 SC 원자적 지급
  INSERT INTO public.credit_accounts (workspace_id, period_start, period_end, timezone)
  VALUES (v_new_ws_id, CURRENT_DATE, (CURRENT_DATE + interval '14 days')::date, 'Asia/Seoul')
  RETURNING id INTO v_credit_acc_id;

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
    v_new_ws_id,
    v_credit_acc_id,
    'grant',
    NULL,
    40000,
    'trial-grant-v089:' || v_new_ws_id::text,
    now()
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  -- J. 6단계: 트라이얼 권한(trial_entitlements) 및 크레딧 상태 원장 생성
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
    'TRIAL_V1',
    v_starts_at,
    v_ends_at,
    'ACTIVE',
    40000
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
    'TRIAL_ACTIVE',
    v_starts_at,
    v_ends_at,
    5000,
    25000,
    10000,
    40000
  )
  ON CONFLICT (workspace_id) DO NOTHING;

  -- K. 7단계: 14일 트라이얼 여정 마일스톤 생성 (Day0 = false)
  PERFORM public.seed_trial_journey_milestones(v_new_ws_id);

  -- L. 8단계: signup_applications 상태 COMPLETED 확정
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
    'is_new_trial', true,
    'credits_granted', 40000
  );
END;
$$;

-- 보안 강화: anon, authenticated, public 권한 회수 및 service_role만 부여
REVOKE ALL ON FUNCTION public.bootstrap_workspace_trial(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_workspace_trial(UUID, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.seed_trial_journey_milestones(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_trial_journey_milestones(UUID) TO service_role;
