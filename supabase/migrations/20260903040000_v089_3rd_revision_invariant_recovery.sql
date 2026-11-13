-- ============================================================================
-- Migration: 20260903040000_v089_3rd_revision_invariant_recovery.sql
-- Epic: ANI-573 (Production Invariant Recovery)
-- Covers: ANI-574, ANI-575, ANI-576, ANI-580, ANI-583, ANI-585, ANI-593
-- ============================================================================

-- 1. [ANI-576] user_agreements pre-workspace null workspace_id support
ALTER TABLE public.user_agreements ALTER COLUMN workspace_id DROP NOT NULL;

-- 2. [ANI-583 / ANI-605] Channel Capabilities Table Migration & Seed
CREATE TABLE IF NOT EXISTS public.channel_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUPPORTED', 'LIMITED', 'REQUIRES_USER_ACTION', 'CAPABILITY_PENDING', 'UNSUPPORTED')),
  description TEXT NOT NULL,
  execution_plane TEXT NOT NULL,
  requires_reauth BOOLEAN NOT NULL DEFAULT false,
  last_verified_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 기존 Production channel_capabilities 테이블 컬럼 및 제약조건 마이그레이션
ALTER TABLE public.channel_capabilities ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE public.channel_capabilities ALTER COLUMN capability DROP NOT NULL;
ALTER TABLE public.channel_capabilities ALTER COLUMN official_source_url DROP NOT NULL;
ALTER TABLE public.channel_capabilities DROP CONSTRAINT IF EXISTS channel_capabilities_channel_check;
ALTER TABLE public.channel_capabilities DROP CONSTRAINT IF EXISTS channel_capabilities_capability_check;
ALTER TABLE public.channel_capabilities DROP CONSTRAINT IF EXISTS channel_capabilities_official_source_url_check;
ALTER TABLE public.channel_capabilities DROP CONSTRAINT IF EXISTS channel_capabilities_workspace_id_channel_key;

ALTER TABLE public.channel_capabilities ADD COLUMN IF NOT EXISTS action_type TEXT;
ALTER TABLE public.channel_capabilities ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE public.channel_capabilities ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.channel_capabilities ADD COLUMN IF NOT EXISTS execution_plane TEXT;
ALTER TABLE public.channel_capabilities ADD COLUMN IF NOT EXISTS requires_reauth BOOLEAN DEFAULT false;
ALTER TABLE public.channel_capabilities ADD COLUMN IF NOT EXISTS provider_version TEXT DEFAULT 'v1';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_channel_action') THEN
    ALTER TABLE public.channel_capabilities ADD CONSTRAINT uq_channel_action UNIQUE (channel, action_type);
  END IF;
END $$;

ALTER TABLE public.channel_capabilities ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'channel_capabilities' AND policyname = 'channel_capabilities_read_all') THEN
    CREATE POLICY "channel_capabilities_read_all" ON public.channel_capabilities FOR SELECT TO authenticated, anon USING (true);
  END IF;
END $$;

-- 4대 채널 Capabilities Seed
INSERT INTO public.channel_capabilities (channel, action_type, status, description, execution_plane, official_source_url, capability)
VALUES
  ('INSTAGRAM', 'PUBLISH_FEED', 'SUPPORTED', 'Meta Graph API 피드 단일/캐러셀 공식 이미지 포스팅', 'META_API_GATEWAY', 'https://developers.facebook.com/docs/instagram-platform', 'supervised_allowed'),
  ('INSTAGRAM', 'REPLY_COMMENT', 'SUPPORTED', '실시간 댓글 조회 및 AI 추천 답글 작성', 'META_API_GATEWAY', 'https://developers.facebook.com/docs/instagram-platform', 'supervised_allowed'),
  ('INSTAGRAM', 'REPLY_DM', 'SUPPORTED', '1:1 고객 문의 DM 자동 응대 및 상담 리드 전환', 'META_API_GATEWAY', 'https://developers.facebook.com/docs/instagram-platform', 'supervised_allowed'),
  ('THREADS', 'PUBLISH_POST', 'SUPPORTED', 'Threads API 공식 단문 포스팅 및 쓰레드 전송', 'META_API_GATEWAY', 'https://developers.facebook.com/docs/threads', 'supervised_allowed'),
  ('THREADS', 'REPLY_POST', 'SUPPORTED', '쓰레드 답글 소통 및 고객 반응 케어', 'META_API_GATEWAY', 'https://developers.facebook.com/docs/threads', 'supervised_allowed'),
  ('NAVER_BLOG', 'PUBLISH_POST', 'SUPPORTED', '스마트에디터 ONE 원클릭 직발행 브릿지 및 Open API 연동', 'BROWSER_AUTOMATION', 'https://blog.naver.com', 'manual_assist_only'),
  ('NAVER_BLOG', 'MANAGE_NEIGHBOR', 'LIMITED', '서로이웃 관리 및 방문 공감 소통 (보조 기능)', 'BROWSER_AUTOMATION', 'https://blog.naver.com', 'manual_assist_only'),
  ('DAANGN', 'BIZ_PROFILE_POST', 'CAPABILITY_PENDING', '당근 비즈프로필 소식 발행 (자동화 검증 준비 중 / 수동 보조 모드)', 'BROWSER_AUTOMATION', 'https://business.daangn.com', 'manual_assist_only')
ON CONFLICT (channel, action_type) DO UPDATE SET
  status = EXCLUDED.status,
  description = EXCLUDED.description,
  execution_plane = EXCLUDED.execution_plane,
  official_source_url = EXCLUDED.official_source_url,
  capability = EXCLUDED.capability,
  updated_at = now();

-- 3. [ANI-585] Day 0 First WOW auto-complete 제거한 올바른 시드 함수
CREATE OR REPLACE FUNCTION public.seed_trial_journey_milestones(p_workspace_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.trial_journey_milestones (
    workspace_id, day_stage, title, description, is_completed, completed_at
  )
  VALUES
    (p_workspace_id, 0, 'Day 0: 첫 AI 시안 확인 및 검증', '소희가 생성한 맞춤형 마케팅 시안을 검토하고 첫 게시를 승인합니다.', false, NULL),
    (p_workspace_id, 1, 'Day 1: 매장 공식 SNS 채널 연동', '인스타그램, 스레드, 네이버 블로그 중 1개 이상의 공식 계정을 연결합니다.', false, NULL),
    (p_workspace_id, 3, 'Day 3: 주간 마케팅 캘린더 수립', '소희가 1주일치 요일별 맞춤 콘텐츠 스케줄을 자동 기획합니다.', false, NULL),
    (p_workspace_id, 7, 'Day 7: 첫 주간 성과 보고서 브리핑', '7일간의 게시 반응, 도달 수, 예상 고객 문의 추이를 분석합니다.', false, NULL),
    (p_workspace_id, 10, 'Day 10: 단골 고객 유입 부스팅', '주말 피크타임 타겟 프로모션 및 혜택 안내를 집중 발행합니다.', false, NULL),
    (p_workspace_id, 13, 'Day 13: 14일 가치 검증 및 ROI 산출', '소희가 절감한 작업 시간과 마케팅 효과를 종합 정산합니다.', false, NULL),
    (p_workspace_id, 14, 'Day 14: 정식 멤버십 전환', '성장 데이터를 유지하고 지속적인 자율 마케팅을 위해 플랜을 선택합니다.', false, NULL)
  ON CONFLICT (workspace_id, day_stage) DO NOTHING;
END;
$$;

-- 4. [ANI-575] bootstrap_workspace_trial 보안 및 Invariant 철저 봉합
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
  v_business_rec RECORD;
  v_starts_at TIMESTAMPTZ := now();
  v_ends_at TIMESTAMPTZ := now() + interval '14 days';
BEGIN
  -- A. 멱등성 검사: 이미 워크스페이스가 존재하는 사용자인 경우
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

  -- B. Invariant 검증 1: signup_applications 상태 검사
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

  -- C. 1단계: 워크스페이스 생성
  INSERT INTO public.workspaces (name, created_by)
  VALUES (COALESCE(p_workspace_name, '나의 소희 마케팅'), p_user_id)
  RETURNING id INTO v_new_ws_id;

  -- D. 2단계: 워크스페이스 멤버십 등록 (소유자)
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_new_ws_id, p_user_id, 'owner');

  -- E. 3단계: 사업자 정보 확정 연결 (business_verifications & business_profiles)
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
  END IF;

  -- F. 4단계: pre-workspace 약관 동의 내역을 신규 워크스페이스로 원자적 연결
  UPDATE public.user_agreements
  SET workspace_id = v_new_ws_id
  WHERE user_id = p_user_id AND (workspace_id IS NULL OR workspace_id = '00000000-0000-0000-0000-000000000000'::uuid);

  -- G. 5단계: 크레딧 계좌 및 14일 40,000 SC 원자적 지급
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

  -- H. 6단계: 트라이얼 권한(trial_entitlements) 및 크레딧 상태 원장 생성
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

  -- I. 7단계: 14일 트라이얼 여정 마일스톤 생성 (Day0 = false)
  PERFORM public.seed_trial_journey_milestones(v_new_ws_id);

  -- J. 8단계: signup_applications 상태 COMPLETED 확정
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

-- [ANI-575] 권한 우회 차단: anon, authenticated, public의 EXECUTE 권한을 전면 박탈하고 service_role만 허용
REVOKE ALL ON FUNCTION public.bootstrap_workspace_trial(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_workspace_trial(UUID, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.seed_trial_journey_milestones(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_trial_journey_milestones(UUID) TO service_role;

-- 5. [ANI-593] Hot-Path Unindexed Foreign Keys 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_signup_apps_ws ON public.signup_applications(workspace_id);
CREATE INDEX IF NOT EXISTS idx_finops_ws ON public.finops_cost_ledger(workspace_id);
CREATE INDEX IF NOT EXISTS idx_kill_switches_engaged_by ON public.kill_switches(engaged_by);
CREATE INDEX IF NOT EXISTS idx_user_agreements_user ON public.user_agreements(user_id);
CREATE INDEX IF NOT EXISTS idx_ext_receipts_ws ON public.external_action_receipts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ext_receipts_action_req ON public.external_action_receipts(action_request_id);
CREATE INDEX IF NOT EXISTS idx_trial_entitlements_ends ON public.trial_entitlements(ends_at);
CREATE INDEX IF NOT EXISTS idx_milestones_ws_day ON public.trial_journey_milestones(workspace_id, day_stage);

-- 6. [ANI-580] RLS Policies for Any Uncovered Tables
DO $$
DECLARE
  tbl text;
  uncovered_tables text[] := ARRAY[
    'legal_document_versions',
    'oauth_nonces',
    'operator_incidents',
    'operator_support_sessions',
    'operator_observations',
    'provider_webhook_events',
    'social_attribution_logs',
    'privileged_support_sessions'
  ];
BEGIN
  FOREACH tbl IN ARRAY uncovered_tables LOOP
    BEGIN
      EXECUTE format('ALTER TABLE IF EXISTS public.%I ENABLE ROW LEVEL SECURITY', tbl);
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = tbl AND policyname = tbl || '_service_all'
      ) THEN
        EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', tbl || '_service_all', tbl);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- table might not exist in all environments, safe ignore
      NULL;
    END;
  END LOOP;
END $$;
