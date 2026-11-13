-- ============================================================================
-- HF-04: Security Definer Least Privilege Closure & Internal AuthZ Hardening
-- Linear Issue: ANI-1353
-- 
-- 1. Eliminate Security Advisor P0 Warnings:
--    - Revoke EXECUTE on admin_verify_business_and_grant_taste from PUBLIC, anon, authenticated.
--      Only service_role (and verified server-side admin) may execute.
--    - Revoke EXECUTE on finalize_signup_and_grant_taste from PUBLIC, anon.
--      Only authenticated and service_role may execute.
--
-- 2. Enforce Strict Internal AuthZ:
--    - finalize_signup_and_grant_taste checks auth.uid() = p_user_id.
--    - admin_verify_business_and_grant_taste checks platform_admin_members membership.
--
-- 3. Enforce search_path = public, auth, pg_temp to prevent search path hijacking.
-- ============================================================================

-- 1. Revoke public/anon execute grants
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'admin_verify_business_and_grant_taste'
  ) THEN
    REVOKE ALL ON FUNCTION public.admin_verify_business_and_grant_taste(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.admin_verify_business_and_grant_taste(UUID, UUID, TEXT, TEXT) FROM anon;
    REVOKE ALL ON FUNCTION public.admin_verify_business_and_grant_taste(UUID, UUID, TEXT, TEXT) FROM authenticated;
    GRANT EXECUTE ON FUNCTION public.admin_verify_business_and_grant_taste(UUID, UUID, TEXT, TEXT) TO service_role;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'finalize_signup_and_grant_taste'
  ) THEN
    REVOKE ALL ON FUNCTION public.finalize_signup_and_grant_taste(UUID, TEXT, TEXT) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.finalize_signup_and_grant_taste(UUID, TEXT, TEXT) FROM anon;
    GRANT EXECUTE ON FUNCTION public.finalize_signup_and_grant_taste(UUID, TEXT, TEXT) TO authenticated, service_role;
  END IF;
END $$;

-- 2. Update finalize_signup_and_grant_taste with search_path and auth.uid() verification
CREATE OR REPLACE FUNCTION public.finalize_signup_and_grant_taste(
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
  v_energy_granted INTEGER;
  v_verification_status TEXT;
  v_credit_acc_id UUID;
  v_starts_at TIMESTAMPTZ := now();
  v_ends_at TIMESTAMPTZ := now() + interval '14 days';
  v_tx_id TEXT;
BEGIN
  -- [P0 AuthZ Guard] Ensure authenticated user cannot impersonate another user_id
  IF auth.role() = 'authenticated' AND auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '본인의 사용자 계정(user_id)으로만 가입을 완료할 수 있습니다 (AUTHZ_IMPERSONATION_DENIED).'
      USING ERRCODE = '42501';
  END IF;

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
    COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1), '소희사용자'),
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
$$;

-- 3. Update admin_verify_business_and_grant_taste with search_path and platform admin check
CREATE OR REPLACE FUNCTION public.admin_verify_business_and_grant_taste(
  p_workspace_id UUID,
  p_operator_id UUID,
  p_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_bv RECORD;
  v_ws RECORD;
  v_ledger RECORD;
  v_claim RECORD;
  v_energy_to_grant INTEGER := 0;
  v_tx_id TEXT;
BEGIN
  -- [P0 AuthZ Guard] Ensure caller is authorized platform admin when called via authenticated role
  IF auth.role() = 'authenticated' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.platform_admin_members WHERE user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION '플랫폼 관리자 권한이 필요합니다 (ADMIN_ROLE_REQUIRED).'
        USING ERRCODE = '42501';
    END IF;
  END IF;

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

    -- free_taste_claims 등록 (이미 동일 사업자번호에 부여된 적이 있는지 검증)
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
      -- 이미 동일 사업자번호로 맛보기를 받은 경우: 중복 지급 금지
      v_energy_to_grant := 0;
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

  -- 5. 감사 로그 기록
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
$$;

NOTIFY pgrst, 'reload schema';
