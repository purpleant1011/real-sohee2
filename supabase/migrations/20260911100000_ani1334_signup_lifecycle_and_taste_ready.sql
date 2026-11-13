-- ============================================================================
-- Migration: 20260911100000_ani1334_signup_lifecycle_and_taste_ready.sql
-- Issue: ANI-1334 / REM-09
-- Purpose: Expand check constraints for signup states, support TASTE_READY
--          and VERIFICATION_PENDING in bootstrap_workspace_trial,
--          and ensure profiles record synchronization on workspace bootstrap.
-- ============================================================================

-- 1. Alter signup_applications_state_check
ALTER TABLE public.signup_applications 
  DROP CONSTRAINT IF EXISTS signup_applications_state_check;

ALTER TABLE public.signup_applications 
  ADD CONSTRAINT signup_applications_state_check 
  CHECK (state IN (
    'FORM_REQUIRED',
    'BUSINESS_PENDING',
    'MANUAL_REVIEW',
    'AGREEMENT_REQUIRED',
    'VERIFICATION_PENDING',
    'TASTE_READY',
    'TRIAL_READY',
    'COMPLETED',
    'REJECTED'
  ));

-- 2. Alter trial_entitlements_status_check
ALTER TABLE public.trial_entitlements
  DROP CONSTRAINT IF EXISTS trial_entitlements_status_check;

ALTER TABLE public.trial_entitlements
  ADD CONSTRAINT trial_entitlements_status_check
  CHECK (status IN (
    'PENDING',
    'ACTIVE',
    'EXPIRED',
    'CONVERTED',
    'REVOKED'
  ));

-- 3. Alter workspace_credit_states_commercial_state_check
ALTER TABLE public.workspace_credit_states
  DROP CONSTRAINT IF EXISTS workspace_credit_states_commercial_state_check;

ALTER TABLE public.workspace_credit_states
  ADD CONSTRAINT workspace_credit_states_commercial_state_check
  CHECK (commercial_state IN (
    'VERIFICATION_PENDING',
    'TRIAL_ACTIVE',
    'PAID_PENDING',
    'ACTIVE',
    'GRACE',
    'PAST_DUE',
    'CANCEL',
    'EXPIRED'
  ));

-- 4. Fix trial_journey_milestones category default and seed function
ALTER TABLE public.trial_journey_milestones ALTER COLUMN category SET DEFAULT 'GENERAL';

CREATE OR REPLACE FUNCTION public.seed_trial_journey_milestones(p_workspace_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.trial_journey_milestones (
    workspace_id, day_stage, title, description, category, is_completed, completed_at
  )
  VALUES
    (p_workspace_id, 0, 'Day 0: 첫 AI 시안 확인 및 검증', '소희가 생성한 맞춤형 마케팅 시안을 검토하고 첫 게시를 승인합니다.', 'FIRST_WOW', false, NULL),
    (p_workspace_id, 1, 'Day 1: 매장 공식 SNS 채널 연동', '인스타그램, 스레드, 네이버 블로그 중 1개 이상의 공식 계정을 연결합니다.', 'CHANNEL_SETUP', false, NULL),
    (p_workspace_id, 3, 'Day 3: 주간 마케팅 캘린더 수립', '소희가 1주일치 요일별 맞춤 콘텐츠 스케줄을 자동 기획합니다.', 'AUTONOMOUS_RUN', false, NULL),
    (p_workspace_id, 7, 'Day 7: 첫 주간 성과 보고서 브리핑', '7일간의 게시 반응, 도달 수, 예상 고객 문의 추이를 분석합니다.', 'PERFORMANCE', false, NULL),
    (p_workspace_id, 10, 'Day 10: 단골 고객 유입 부스팅', '주말 피크타임 타겟 프로모션 및 혜택 안내를 집중 발행합니다.', 'BOOSTING', false, NULL),
    (p_workspace_id, 13, 'Day 13: 14일 가치 검증 및 ROI 산출', '소희가 절감한 작업 시간과 마케팅 효과를 종합 정산합니다.', 'ROI_SUMMARY', false, NULL),
    (p_workspace_id, 14, 'Day 14: 정식 멤버십 전환', '성장 데이터를 유지하고 지속적인 자율 마케팅을 위해 플랜을 선택합니다.', 'COMMERCIAL_CONVERSION', false, NULL)
  ON CONFLICT (workspace_id, day_stage) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_workspace_trial(
  p_user_id uuid,
  p_provider text DEFAULT 'google'::text,
  p_workspace_name text DEFAULT '나의 소희 마케팅'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_existing_ws_id UUID;
  v_new_ws_id UUID;
  v_credit_acc_id UUID;
  v_signup_app RECORD;
  v_is_pending BOOLEAN := false;
  v_starts_at TIMESTAMPTZ := now();
  v_ends_at TIMESTAMPTZ := now() + interval '14 days';
BEGIN
  -- A. 멱등성 검사: 이미 워크스페이스가 존재하는 사용자인 경우 기존 워크스페이스 반환
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

  -- B. Invariant 검증 1: signup_applications 상태 검사 (TASTE_READY, TRIAL_READY, VERIFICATION_PENDING 지원)
  SELECT * INTO v_signup_app
  FROM public.signup_applications
  WHERE user_id = p_user_id;

  IF v_signup_app IS NULL THEN
    RAISE EXCEPTION '신규 회원가입 신청서(signup_applications)가 존재하지 않습니다.';
  END IF;

  IF v_signup_app.state NOT IN ('TASTE_READY', 'TRIAL_READY', 'VERIFICATION_PENDING', 'COMPLETED') THEN
    RAISE EXCEPTION '가입 상태(%)가 TASTE_READY 또는 VERIFICATION_PENDING이 아니므로 트라이얼을 활성화할 수 없습니다.', v_signup_app.state;
  END IF;

  IF NOT v_signup_app.agreements_completed THEN
    RAISE EXCEPTION '필수 법적 약관 및 위임 동의가 완료되지 않았습니다.';
  END IF;

  v_is_pending := (v_signup_app.state = 'VERIFICATION_PENDING');

  -- C. User Profile 동기화 보장 (ANI-1334)
  INSERT INTO public.profiles (id, display_name, updated_at)
  VALUES (
    p_user_id,
    COALESCE(
      (SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = p_user_id),
      (SELECT raw_user_meta_data->>'name' FROM auth.users WHERE id = p_user_id),
      '사용자'
    ),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  -- D. 1단계: 워크스페이스 생성
  INSERT INTO public.workspaces (name, created_by)
  VALUES (COALESCE(p_workspace_name, '나의 소희 마케팅'), p_user_id)
  RETURNING id INTO v_new_ws_id;

  -- E. 2단계: 워크스페이스 멤버십 등록 (소유자 - 트리거 자동 생성 고려 멱등성 보장)
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_new_ws_id, p_user_id, 'owner')
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner';

  -- F. 3단계: 사업자 정보 확정 연결 (business_verifications & business_profiles)
  IF v_signup_app.business_number IS NOT NULL AND v_signup_app.company_name IS NOT NULL THEN
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
      CASE WHEN v_is_pending THEN 'PENDING' ELSE 'VERIFIED' END,
      CASE WHEN v_is_pending THEN NULL ELSE now() END
    )
    ON CONFLICT (workspace_id) DO UPDATE SET
      business_number = EXCLUDED.business_number,
      company_name = EXCLUDED.company_name,
      representative_name = EXCLUDED.representative_name,
      status = CASE WHEN v_is_pending THEN 'PENDING' ELSE 'VERIFIED' END,
      verified_at = CASE WHEN v_is_pending THEN NULL ELSE now() END;

    INSERT INTO public.business_profiles (workspace_id, business_name, summary, updated_at)
    VALUES (
      v_new_ws_id,
      v_signup_app.company_name,
      CASE WHEN v_is_pending THEN '소희 사업자 수동 심사 접수 매장 (확인 대기)' ELSE '신규 정식 가입 매장' END,
      now()
    )
    ON CONFLICT (workspace_id) DO UPDATE SET
      business_name = EXCLUDED.business_name,
      updated_at = now();
  END IF;

  -- G. 4단계: pre-workspace 약관 동의 내역을 신규 워크스페이스로 원자적 연결
  UPDATE public.user_agreements
  SET workspace_id = v_new_ws_id
  WHERE user_id = p_user_id AND (workspace_id IS NULL OR workspace_id = '00000000-0000-0000-0000-000000000000'::uuid);

  -- H. 5단계: 크레딧 계좌 생성
  INSERT INTO public.credit_accounts (workspace_id, period_start, period_end, timezone)
  VALUES (v_new_ws_id, CURRENT_DATE, (CURRENT_DATE + interval '14 days')::date, 'Asia/Seoul')
  RETURNING id INTO v_credit_acc_id;

  -- H-1: 정식 인증된 경우에만 40,000 SC (하위호환) 원장 기록
  IF NOT v_is_pending THEN
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
    ON CONFLICT (workspace_id, idempotency_key, kind) DO NOTHING;
  END IF;

  -- I. 6단계: 트라이얼 권한(trial_entitlements) 및 크레딧 상태 원장 생성
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
    CASE WHEN v_is_pending THEN 'PENDING' ELSE 'ACTIVE' END,
    CASE WHEN v_is_pending THEN 0 ELSE 40000 END
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
    CASE WHEN v_is_pending THEN 'VERIFICATION_PENDING' ELSE 'TRIAL_ACTIVE' END,
    v_starts_at,
    v_ends_at,
    CASE WHEN v_is_pending THEN 0 ELSE 5000 END,
    CASE WHEN v_is_pending THEN 0 ELSE 25000 END,
    CASE WHEN v_is_pending THEN 0 ELSE 10000 END,
    CASE WHEN v_is_pending THEN 0 ELSE 40000 END
  )
  ON CONFLICT (workspace_id) DO NOTHING;

  -- J. 7단계: 14일 트라이얼 여정 마일스톤 생성
  PERFORM public.seed_trial_journey_milestones(v_new_ws_id);

  -- K. 8단계: signup_applications 상태 확정
  UPDATE public.signup_applications
  SET
    workspace_id = v_new_ws_id,
    state = CASE WHEN v_is_pending THEN 'VERIFICATION_PENDING' ELSE 'COMPLETED' END,
    completed_at = CASE WHEN v_is_pending THEN NULL ELSE now() END,
    updated_at = now()
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'workspace_id', v_new_ws_id,
    'is_new_trial', true,
    'credits_granted', CASE WHEN v_is_pending THEN 0 ELSE 40000 END,
    'verification_status', CASE WHEN v_is_pending THEN 'PENDING' ELSE 'VERIFIED' END
  );
END;
$function$;
