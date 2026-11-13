-- ==============================================================================
-- HF-59: Restore finalize_signup_and_grant_taste RPC with Authenticated Least-Privilege
--
-- Traceability: ANI-1425 / ANI-1424 / ANI-1385
-- Invariant:
-- 1. SECURITY DEFINER with fixed search_path = public, pg_temp
-- 2. Strict AuthZ guard: auth.role() = 'authenticated' AND auth.uid() <> p_user_id => 42501 AUTHZ_IMPERSONATION_DENIED
-- 3. Fail-closed signup state validation ('TASTE_READY', 'VERIFICATION_PENDING')
-- 4. Mandatory completed agreements & valid business number verification
-- 5. Exactly-once free taste claim & idempotent workspace return
-- 6. Grants: EXECUTE to service_role, authenticated. REVOKE from PUBLIC, anon.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.finalize_signup_and_grant_taste(
  p_user_id uuid,
  p_workspace_name text DEFAULT NULL::text,
  p_provider text DEFAULT 'google'::text
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
$function$;

-- Revoke all default privileges from public and anon
REVOKE ALL ON FUNCTION public.finalize_signup_and_grant_taste(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_signup_and_grant_taste(uuid, text, text) FROM anon;

-- Grant execute to authenticated users (with internal self-user AuthZ guard) and service_role
GRANT EXECUTE ON FUNCTION public.finalize_signup_and_grant_taste(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_signup_and_grant_taste(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.finalize_signup_and_grant_taste(uuid, text, text) IS
  'HF-59: Finalize signup and grant taste energy. SECURITY DEFINER with strict authenticated self-user guard (auth.uid() = p_user_id) preventing impersonation, fail-closed state/business/agreement validations, and exactly-once taste claim.';
