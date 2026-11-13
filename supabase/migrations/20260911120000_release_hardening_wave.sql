-- ==============================================================================
-- Migration: 20260911120000_release_hardening_wave.sql
-- Description: SOHEE 0.91 Release Hardening Wave (ANI-1334)
--   P0-1: user_agreements Contract Alignment (UNIQUE user_id, agreement_type, version)
--   P0-2: Energy / Business Verification RLS Lockdown (SELECT only for authenticated)
--   P0-3: Atomized Signup Finalize & Admin Verification Single RPCs (Zero Partial State)
--   P0-4: Exactly Once Free Taste DB Invariant (free_taste_claims table)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. [P0-1] user_agreements DB Contract 정합성 정비
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_agreements'::regclass
      AND conname = 'uq_user_agreement'
  ) THEN
    ALTER TABLE public.user_agreements DROP CONSTRAINT uq_user_agreement;
  END IF;
END $$;

ALTER TABLE public.user_agreements
  ADD CONSTRAINT uq_user_agreement UNIQUE (user_id, agreement_type, version);

-- ------------------------------------------------------------------------------
-- 2. [P0-4] Exactly-Once Free Taste DB Invariant 테이블 신설
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.free_taste_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_number TEXT NOT NULL,
  benefit_type TEXT NOT NULL DEFAULT 'FREE_TASTE_50',
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  claimed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  energy_granted INTEGER NOT NULL DEFAULT 50,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_free_taste_claim UNIQUE (business_number, benefit_type)
);

ALTER TABLE public.free_taste_claims ENABLE ROW LEVEL SECURITY;

-- 일반 사용자는 본인 워크스페이스 내역만 SELECT 가능, 직접 INSERT/UPDATE/DELETE 불가
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'free_taste_claims' AND policyname = 'free_taste_claims_select'
  ) THEN
    CREATE POLICY "free_taste_claims_select" ON public.free_taste_claims
      FOR SELECT TO authenticated
      USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. [P0-2] 5개 핵심 테이블의 RLS 완전 잠금 (SELECT Only for authenticated)
-- ------------------------------------------------------------------------------

-- 3.1 agent_energy_ledgers: 기존 ALL 권한 정책 제거 후 SELECT만 허용
DROP POLICY IF EXISTS "energy_ledgers_tenant_isolation" ON public.agent_energy_ledgers;
DROP POLICY IF EXISTS "agent_energy_ledgers_select" ON public.agent_energy_ledgers;
CREATE POLICY "agent_energy_ledgers_select" ON public.agent_energy_ledgers
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

-- 3.2 agent_energy_transactions: 기존 ALL 권한 정책 제거 후 SELECT만 허용
DROP POLICY IF EXISTS "energy_tx_tenant_isolation" ON public.agent_energy_transactions;
DROP POLICY IF EXISTS "agent_energy_transactions_select" ON public.agent_energy_transactions;
CREATE POLICY "agent_energy_transactions_select" ON public.agent_energy_transactions
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

-- 3.3 business_verifications: 기존 INSERT/UPDATE 권한 제거 (SELECT만 남김)
DROP POLICY IF EXISTS "business_verifications_insert" ON public.business_verifications;
DROP POLICY IF EXISTS "business_verifications_update" ON public.business_verifications;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'business_verifications' AND policyname = 'business_verifications_select'
  ) THEN
    CREATE POLICY "business_verifications_select" ON public.business_verifications
      FOR SELECT TO authenticated
      USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 4. [P0-3] 단일 원자적 Postgres RPC: finalize_signup_and_grant_taste
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_signup_and_grant_taste(
  p_user_id UUID,
  p_workspace_name TEXT DEFAULT NULL,
  p_provider TEXT DEFAULT 'google'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_signup_app RECORD;
  v_new_ws_id UUID;
  v_is_verified BOOLEAN;
  v_energy_granted INTEGER;
  v_verification_status TEXT;
  v_credit_acc_id UUID;
  v_starts_at TIMESTAMPTZ := now();
  v_ends_at TIMESTAMPTZ := now() + interval '14 days';
  v_tx_id TEXT;
BEGIN
  -- 1. 가입 신청서 상태 확인 및 락
  SELECT * INTO v_signup_app
  FROM public.signup_applications
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '신규 가입 신청서를 찾을 수 없습니다. (ANI-733)'
      USING ERRCODE = 'P0002';
  END IF;

  -- 2. 멱등성 검사: 이미 완료되어 워크스페이스가 할당된 경우 기존 정보 반환
  IF v_signup_app.state = 'COMPLETED' AND v_signup_app.workspace_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'workspace_id', v_signup_app.workspace_id,
      'is_new_workspace', false,
      'energy_granted', 0,
      'plan_tier', 'FREE_TASTE',
      'verification_status', 'VERIFIED'
    );
  END IF;

  -- 3. 가입 가능 상태 검증 (TASTE_READY 또는 VERIFICATION_PENDING)
  IF v_signup_app.state NOT IN ('TASTE_READY', 'VERIFICATION_PENDING') THEN
    RAISE EXCEPTION '현재 상태(%)에서는 무료 맛보기 Energy를 활성화할 수 없습니다. 사업자 검증과 필수 동의를 먼저 완료해 주세요. (ANI-733)', v_signup_app.state
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. 필수 약관 동의 검증
  IF NOT v_signup_app.agreements_completed THEN
    RAISE EXCEPTION '필수 약관 및 채널 위임 동의가 완료되지 않았습니다. (ANI-733)'
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. 사업자등록번호 유효성 검증
  IF v_signup_app.business_number IS NULL OR v_signup_app.business_number = '0000000000' OR length(v_signup_app.business_number) < 10 THEN
    RAISE EXCEPTION '유효한 사업자등록번호가 등록되지 않아 가입을 완료할 수 없습니다. (ANI-733)'
      USING ERRCODE = 'P0001';
  END IF;

  v_is_verified := (v_signup_app.state = 'TASTE_READY');
  v_energy_granted := CASE WHEN v_is_verified THEN 50 ELSE 0 END;
  v_verification_status := CASE WHEN v_is_verified THEN 'VERIFIED' ELSE 'PENDING' END;

  -- 6. 사용자 프로필 동기화 보장
  INSERT INTO public.profiles (id, display_name, updated_at)
  SELECT
    u.id,
    COALESCE(u.email, 'unknown@example.com'),
    COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
    'user',
    now()
  FROM auth.users u
  WHERE u.id = p_user_id
  ON CONFLICT (id) DO UPDATE SET
    display_name = COALESCE(EXCLUDED.display_name, profiles.display_name),
    updated_at = now();

  -- 7. 워크스페이스 생성
  INSERT INTO public.workspaces (name, created_by)
  VALUES (
    COALESCE(p_workspace_name, v_signup_app.company_name, '나의 소희 마케팅'),
    p_user_id
  )
  RETURNING id INTO v_new_ws_id;

  -- 8. 워크스페이스 멤버십 등록 (소유자)
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_new_ws_id, p_user_id, 'owner')
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner';

  -- 9. 사업자 정보 및 프로필 확정 연결
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
    CASE WHEN v_is_verified THEN '신규 정식 가입 매장' ELSE '소희 사업자 수동 심사 접수 매장 (확인 대기)' END,
    now()
  )
  ON CONFLICT (workspace_id) DO UPDATE SET
    business_name = EXCLUDED.business_name,
    updated_at = now();

  -- 10. [P0-4 DB Invariant] 정식 인증(50 Energy) 대상인 경우 Exactly-Once Claim 등록
  IF v_is_verified THEN
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
        v_signup_app.business_number,
        'FREE_TASTE_50',
        v_new_ws_id,
        p_user_id,
        50,
        now()
      );
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION '이미 소희 무료 맛보기 혜택이 지급된 사업자등록번호입니다. 사업자당 1회의 무료 지원금만 제공됩니다. (ANI-733)'
        USING ERRCODE = '23505';
    END;
  END IF;

  -- 11. [P0-1] pre-workspace 약관 동의 내역을 신규 워크스페이스로 원자적 연결
  UPDATE public.user_agreements
  SET workspace_id = v_new_ws_id
  WHERE user_id = p_user_id AND (workspace_id IS NULL OR workspace_id = '00000000-0000-0000-0000-000000000000'::uuid);

  -- 12. Energy 원장(agent_energy_ledgers) 등록
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
    'FREE_TASTE',
    v_energy_granted,
    0,
    0,
    v_energy_granted,
    0,
    'NORMAL',
    30,
    now()
  )
  ON CONFLICT (workspace_id) DO UPDATE SET
    monthly_total_energy = EXCLUDED.monthly_total_energy,
    remaining_available_energy = EXCLUDED.remaining_available_energy,
    updated_at = now();

  -- 13. 정식 인증인 경우 트랜잭션(agent_energy_transactions) 기록
  IF v_energy_granted > 0 THEN
    v_tx_id := 'tx_taste_' || floor(extract(epoch from now()) * 1000)::text || '_' || substr(v_new_ws_id::text, 1, 8);
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
      v_new_ws_id,
      1,
      0,
      v_energy_granted,
      now()
    );
  END IF;

  -- 14. 하위 호환 크레딧 및 트라이얼 등록
  INSERT INTO public.credit_accounts (workspace_id, period_start, period_end, timezone)
  VALUES (v_new_ws_id, CURRENT_DATE, (CURRENT_DATE + interval '14 days')::date, 'Asia/Seoul')
  RETURNING id INTO v_credit_acc_id;

  IF v_is_verified THEN
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
    CASE WHEN v_is_verified THEN 'ACTIVE' ELSE 'PENDING' END,
    CASE WHEN v_is_verified THEN 40000 ELSE 0 END
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
    CASE WHEN v_is_verified THEN 'TRIAL_ACTIVE' ELSE 'VERIFICATION_PENDING' END,
    v_starts_at,
    v_ends_at,
    CASE WHEN v_is_verified THEN 5000 ELSE 0 END,
    CASE WHEN v_is_verified THEN 25000 ELSE 0 END,
    CASE WHEN v_is_verified THEN 10000 ELSE 0 END,
    CASE WHEN v_is_verified THEN 40000 ELSE 0 END
  )
  ON CONFLICT (workspace_id) DO NOTHING;

  -- 15. 트라이얼 여정 마일스톤 생성
  PERFORM public.seed_trial_journey_milestones(v_new_ws_id);

  -- 16. signup_applications 상태 확정
  UPDATE public.signup_applications
  SET
    workspace_id = v_new_ws_id,
    state = CASE WHEN v_is_verified THEN 'COMPLETED' ELSE 'VERIFICATION_PENDING' END,
    completed_at = CASE WHEN v_is_verified THEN now() ELSE NULL END,
    updated_at = now()
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'workspace_id', v_new_ws_id,
    'is_new_workspace', true,
    'energy_granted', v_energy_granted,
    'plan_tier', 'FREE_TASTE',
    'verification_status', v_verification_status
  );
END;
$function$;

-- ------------------------------------------------------------------------------
-- 5. [P0-3] 관리자 심사 및 1회성 맛보기 부여 단일 원자적 Postgres RPC
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_verify_business_and_grant_taste(
  p_workspace_id UUID,
  p_operator_id UUID,
  p_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bv RECORD;
  v_ws RECORD;
  v_ledger RECORD;
  v_claim RECORD;
  v_energy_to_grant INTEGER := 0;
  v_tx_id TEXT;
BEGIN
  -- 1. 상태 파라미터 검증
  IF p_status NOT IN ('VERIFIED', 'REJECTED', 'PENDING', 'DOCUMENT_REQUIRED', 'MISMATCH') THEN
    RAISE EXCEPTION '유효한 심사 상태가 필요합니다. (status: %)', p_status
      USING ERRCODE = 'P0001';
  END IF;

  -- 2. 워크스페이스 및 사업자 정보 확인
  SELECT * INTO v_ws FROM public.workspaces WHERE id = p_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '워크스페이스를 찾을 수 없습니다. (id: %)', p_workspace_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_bv FROM public.business_verifications WHERE workspace_id = p_workspace_id FOR UPDATE;

  -- 3. 승인(VERIFIED) 시 사업자정보 유효성 및 중복 방어
  IF p_status = 'VERIFIED' THEN
    IF v_bv.business_number IS NULL OR v_bv.business_number = '0000000000' OR length(v_bv.business_number) < 10 THEN
      RAISE EXCEPTION '유효한 사업자등록번호가 없어 VERIFIED 승인이 불가합니다. (ANI-603)'
        USING ERRCODE = 'P0001';
    END IF;

    IF v_bv.company_name IS NULL OR v_bv.company_name = '심사 대상 매장' THEN
      RAISE EXCEPTION '유효한 상호명이 확인되지 않아 VERIFIED 승인이 불가합니다. (ANI-603)'
        USING ERRCODE = 'P0001';
    END IF;

    -- [P0-4] free_taste_claims 등록 (이미 동일 사업자번호에 부여된 적이 있는지 검증)
    SELECT * INTO v_claim FROM public.free_taste_claims
    WHERE business_number = v_bv.business_number AND benefit_type = 'FREE_TASTE_50';

    IF NOT FOUND THEN
      -- 신규 클레임 등록
      INSERT INTO public.free_taste_claims (
        business_number,
        benefit_type,
        workspace_id,
        claimed_by,
        energy_granted,
        claimed_at
      )
      VALUES (
        v_bv.business_number,
        'FREE_TASTE_50',
        p_workspace_id,
        v_ws.created_by,
        50,
        now()
      );
      v_energy_to_grant := 50;
    ELSE
      -- 이미 동일 사업자번호로 맛보기를 받은 경우 (다른 워크스페이스이거나 기지급)
      IF v_claim.workspace_id = p_workspace_id THEN
        -- 본인 워크스페이스에 이미 지급된 적이 있음: 추가 지급 없이 승인만 진행
        v_energy_to_grant := 0;
      ELSE
        -- 다른 워크스페이스에서 이미 수령한 사업자번호: 에너지 중복 지급 금지
        v_energy_to_grant := 0;
      END IF;
    END IF;

    -- 에너지 원장 업데이트
    SELECT * INTO v_ledger FROM public.agent_energy_ledgers WHERE workspace_id = p_workspace_id FOR UPDATE;

    IF v_energy_to_grant > 0 THEN
      IF NOT FOUND THEN
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
        );
      ELSE
        UPDATE public.agent_energy_ledgers
        SET
          monthly_total_energy = monthly_total_energy + 50,
          remaining_available_energy = remaining_available_energy + 50,
          updated_at = now()
        WHERE workspace_id = p_workspace_id;
      END IF;

      -- 트랜잭션 기록
      v_tx_id := 'tx_taste_admin_' || floor(extract(epoch from now()) * 1000)::text || '_' || substr(p_workspace_id::text, 1, 8);
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
    END IF;

    -- 하위 호환 크레딧 및 트라이얼 활성화
    UPDATE public.trial_entitlements
    SET
      status = 'ACTIVE',
      initial_credit_grant = 40000,
      updated_at = now()
    WHERE workspace_id = p_workspace_id;

    UPDATE public.workspace_credit_states
    SET
      commercial_state = 'TRIAL_ACTIVE',
      activation_credits = 5000,
      agent_credits = 25000,
      protected_wow_credits = 10000,
      total_available_credits = 40000,
      updated_at = now()
    WHERE workspace_id = p_workspace_id;

    -- 가입 신청서 확정 (VERIFICATION_PENDING -> COMPLETED)
    IF v_ws.created_by IS NOT NULL THEN
      UPDATE public.signup_applications
      SET
        state = 'COMPLETED',
        completed_at = now(),
        updated_at = now()
      WHERE user_id = v_ws.created_by AND state = 'VERIFICATION_PENDING';
    END IF;
  END IF;

  -- 4. business_verifications 테이블 갱신
  UPDATE public.business_verifications
  SET
    status = p_status,
    rejection_reason = CASE WHEN p_status = 'REJECTED' THEN p_reason ELSE NULL END,
    verified_at = CASE WHEN p_status = 'VERIFIED' THEN now() ELSE NULL END,
    updated_at = now()
  WHERE workspace_id = p_workspace_id;

  -- 5. 감사 로그 기록 (실패 시 트랜잭션 전체 롤백)
  INSERT INTO public.audit_events (
    workspace_id,
    entity_type,
    entity_id,
    event_type,
    metadata
  )
  VALUES (
    p_workspace_id,
    'business_verification',
    p_workspace_id,
    'admin_business_verification_status_change',
    jsonb_build_object(
      'operator_id', p_operator_id,
      'new_status', p_status,
      'business_number', v_bv.business_number,
      'company_name', v_bv.company_name,
      'reason', COALESCE(p_reason, '운영자 직접 심사 처리'),
      'energy_granted', v_energy_to_grant
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'workspace_id', p_workspace_id,
    'status', p_status,
    'energy_granted', v_energy_to_grant
  );
END;
$function$;
