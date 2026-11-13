-- ==============================================================================
-- Migration: 20260912140000_hf06_production_containment_and_reconciliation.sql
-- Issue: [HF-06][P0] Production DB Containment & Migration Reconciliation
-- Date: 2026-09-12
--
-- Rationale:
-- 1. Fix workspace_credit_states_commercial_state_check to permit 'EDUCATION_MODE'.
-- 2. Harden grant_sohee_ready_starter_entitlement (Defense-in-depth):
--    - Revoke EXECUTE from authenticated and anon (service_role ONLY).
--    - Re-verify canonical 7 SOHEE_READY facts inside DB RPC before any grant.
-- 3. Provide get_applied_migrations() RPC for verified zero-drift gating.
-- 4. Reconcile schema_migrations ledger for 20260912 migrations.
-- ==============================================================================

-- 1. Extend workspace_credit_states check constraint to include 'EDUCATION_MODE'
ALTER TABLE public.workspace_credit_states
  DROP CONSTRAINT IF EXISTS workspace_credit_states_commercial_state_check;

ALTER TABLE public.workspace_credit_states
  ADD CONSTRAINT workspace_credit_states_commercial_state_check
  CHECK (commercial_state = ANY (ARRAY[
    'EDUCATION_MODE'::text,
    'VERIFICATION_PENDING'::text,
    'TRIAL_ACTIVE'::text,
    'PAID_PENDING'::text,
    'ACTIVE'::text,
    'GRACE'::text,
    'PAST_DUE'::text,
    'CANCEL'::text,
    'EXPIRED'::text
  ]));

-- 2. Redefine grant_sohee_ready_starter_entitlement with canonical 7 facts defense-in-depth
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

  -- [AuthZ Guard] Ensure caller belongs to workspace if authenticated
  IF auth.role() = 'authenticated' AND auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = p_workspace_id AND user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION '해당 워크스페이스의 멤버만 스타터 혜택을 수령할 수 있습니다 (AUTHZ_WORKSPACE_DENIED).'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- ============================================================================
  -- [HF-Canonical Invariant] 7대 불변 사실(SOHEE_READY Canonical 7 Facts) 전수 검증
  -- ============================================================================

  -- Fact 1. 국세청 사업자 진위확인 (BUSINESS_VERIFIED)
  SELECT * INTO v_biz_ver
  FROM public.business_verifications
  WHERE workspace_id = p_workspace_id
    AND status = 'VERIFIED';

  IF NOT FOUND OR v_biz_ver.business_number IS NULL THEN
    RAISE EXCEPTION '국세청 사업자 진위확인이 완료되지 않아 스타터 혜택을 지급할 수 없습니다 (BUSINESS_NOT_VERIFIED).'
      USING ERRCODE = '42501';
  END IF;

  -- Fact 2. 인스타그램 채널 연동 및 검증 (INSTAGRAM_VERIFIED)
  IF NOT EXISTS (
    SELECT 1 FROM public.channel_verification_runs
    WHERE workspace_id = p_workspace_id
      AND channel = 'instagram'
      AND status = 'VERIFIED'
  ) THEN
    RAISE EXCEPTION '인스타그램 계정 연동 및 검증이 완료되지 않아 스타터 혜택을 지급할 수 없습니다 (INSTAGRAM_NOT_VERIFIED).'
      USING ERRCODE = '42501';
  END IF;

  -- Fact 3. 스레드 채널 연동 및 검증 (THREADS_VERIFIED)
  IF NOT EXISTS (
    SELECT 1 FROM public.channel_verification_runs
    WHERE workspace_id = p_workspace_id
      AND channel = 'threads'
      AND status = 'VERIFIED'
  ) THEN
    RAISE EXCEPTION '스레드 계정 연동 및 검증이 완료되지 않아 스타터 혜택을 지급할 수 없습니다 (THREADS_NOT_VERIFIED).'
      USING ERRCODE = '42501';
  END IF;

  -- Fact 4. 사업 기본 지식 확정 (BUSINESS_KNOWLEDGE_CONFIRMED)
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_knowledge_harnesses
    WHERE workspace_id = p_workspace_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION '사업 기본 지식이 확정되지 않아 스타터 혜택을 지급할 수 없습니다 (BUSINESS_KNOWLEDGE_NOT_CONFIRMED).'
      USING ERRCODE = '42501';
  END IF;

  -- Fact 5. 텍스트 하네스 확정 (TEXT_HARNESS_CONFIRMED)
  IF NOT EXISTS (
    SELECT 1 FROM public.harness_rules
    WHERE workspace_id = p_workspace_id
      AND rule_type = 'text_generation'
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION '텍스트 하네스 기준이 확정되지 않아 스타터 혜택을 지급할 수 없습니다 (TEXT_HARNESS_NOT_CONFIRMED).'
      USING ERRCODE = '42501';
  END IF;

  -- Fact 6. 이미지 하네스 확정 (IMAGE_HARNESS_CONFIRMED)
  IF NOT EXISTS (
    SELECT 1 FROM public.harness_rules
    WHERE workspace_id = p_workspace_id
      AND rule_type = 'image_generation'
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION '이미지 하네스 기준이 확정되지 않아 스타터 혜택을 지급할 수 없습니다 (IMAGE_HARNESS_NOT_CONFIRMED).'
      USING ERRCODE = '42501';
  END IF;

  -- Fact 7. 운영 정책 확정 (OPERATING_POLICY_CONFIRMED)
  IF NOT EXISTS (
    SELECT 1 FROM public.harness_rules
    WHERE workspace_id = p_workspace_id
      AND rule_type = 'approval_policy'
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION '운영 정책 기준이 확정되지 않아 스타터 혜택을 지급할 수 없습니다 (OPERATING_POLICY_NOT_CONFIRMED).'
      USING ERRCODE = '42501';
  END IF;

  -- ============================================================================
  -- [Exactly-Once Idempotency Check] uq_free_taste_claim 기반 중복 조회
  -- ============================================================================
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

  -- Exactly-Once DB Claim 기록 (uq_free_taste_claim에 의해 동시 호출 시에도 1회만 성공)
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

  -- Production Execution Entitlement 지급: 50 Energy
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

  -- 하위 호환 Credit 및 Trial Entitlement 지급: 40,000 Credits
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

  -- 트라이얼 여정 마일스톤 생성
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

-- 3. Revoke authenticated/anon from grant_sohee_ready_starter_entitlement (service_role ONLY)
REVOKE ALL ON FUNCTION public.grant_sohee_ready_starter_entitlement(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_sohee_ready_starter_entitlement(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.grant_sohee_ready_starter_entitlement(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.grant_sohee_ready_starter_entitlement(UUID, UUID) TO service_role;

-- 4. Provide get_applied_migrations helper RPC for drift verification (service_role ONLY)
CREATE OR REPLACE FUNCTION public.get_applied_migrations()
RETURNS TABLE(version text, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = supabase_migrations, public, pg_temp
AS $$
  SELECT version, COALESCE(name, version) FROM supabase_migrations.schema_migrations ORDER BY version ASC;
$$;

REVOKE ALL ON FUNCTION public.get_applied_migrations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_applied_migrations() FROM anon;
REVOKE ALL ON FUNCTION public.get_applied_migrations() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_applied_migrations() TO service_role;

-- 5. Reconcile schema_migrations ledger for all 20260912 migrations
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES 
  ('20260912120000', '20260912120000_hf04_security_definer_least_privilege'),
  ('20260912130000', '20260912130000_hf05_education_budget_and_starter_entitlement'),
  ('20260912140000', '20260912140000_hf06_production_containment_and_reconciliation')
ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name;
