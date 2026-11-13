-- ============================================================================
-- Migration: 20261021070000_finalize_email_signup_atomic_rpc.sql
-- Issue: ANI-1585 / Atomic Email Signup Finalization & Audit Invariant
-- Purpose: Single atomic PostgreSQL transaction for user agreements,
--          signup_applications linking, start_date preservation, and audit.
-- Security: service_role ONLY execution; anonymous/authenticated denied.
-- ============================================================================

-- 1. Helper to safely prepare or preserve signup_applications prior to workspace provision
CREATE OR REPLACE FUNCTION public.prepare_signup_application_atomic(
  p_user_id UUID,
  p_business_number TEXT,
  p_company_name TEXT,
  p_representative_name TEXT,
  p_is_verified BOOLEAN DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_app RECORD;
  v_now TIMESTAMPTZ := now();
  v_state TEXT;
  v_final_bnum TEXT;
  v_final_cname TEXT;
  v_final_rname TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = 'P0001';
  END IF;

  v_state := CASE WHEN p_is_verified THEN 'TASTE_READY' ELSE 'VERIFICATION_PENDING' END;
  SELECT * INTO v_app FROM public.signup_applications WHERE user_id = p_user_id FOR UPDATE;

  IF FOUND THEN
    -- Preserve existing authentic non-null business values
    v_final_bnum := COALESCE(v_app.business_number, NULLIF(btrim(p_business_number), ''));
    v_final_cname := COALESCE(v_app.company_name, NULLIF(btrim(p_company_name), ''));
    v_final_rname := COALESCE(v_app.representative_name, NULLIF(btrim(p_representative_name), ''));

    UPDATE public.signup_applications
    SET
      business_number = v_final_bnum,
      company_name = v_final_cname,
      representative_name = v_final_rname,
      state = CASE WHEN v_app.state = 'COMPLETED' THEN 'COMPLETED' ELSE v_state END,
      agreements_completed = v_app.agreements_completed,
      updated_at = v_now
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object(
      'success', true,
      'is_new', false,
      'workspace_id', v_app.workspace_id,
      'state', v_app.state,
      'agreements_completed', v_app.agreements_completed
    );
  ELSE
    v_final_bnum := NULLIF(btrim(p_business_number), '');
    v_final_cname := NULLIF(btrim(p_company_name), '');
    v_final_rname := NULLIF(btrim(p_representative_name), '');

    INSERT INTO public.signup_applications (
      user_id, workspace_id, business_number, company_name, representative_name, state, agreements_completed, created_at, updated_at
    )
    VALUES (
      p_user_id, null, v_final_bnum, v_final_cname, v_final_rname, v_state, false, v_now, v_now
    );

    RETURN jsonb_build_object(
      'success', true,
      'is_new', true,
      'workspace_id', null,
      'state', v_state,
      'agreements_completed', false
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_signup_application_atomic(UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_signup_application_atomic(UUID, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;

-- 2. Final atomic linking, agreement persistence, start_date preservation, and audit logging
CREATE OR REPLACE FUNCTION public.finalize_email_signup_atomic(
  p_user_id UUID,
  p_workspace_id UUID DEFAULT NULL,
  p_business_number TEXT DEFAULT NULL,
  p_company_name TEXT DEFAULT NULL,
  p_representative_name TEXT DEFAULT NULL,
  p_start_date TEXT DEFAULT NULL,
  p_is_verified BOOLEAN DEFAULT false,
  p_marketing_agreed BOOLEAN DEFAULT NULL,
  p_agreements_version TEXT DEFAULT '2026.09-v1',
  p_ip_address TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_app RECORD;
  v_bv RECORD;
  v_existing_ag RECORD;
  v_clean_start_date TEXT;
  v_stored_start_date TEXT;
  v_start_date_saved BOOLEAN := false;
  v_audit_idem TEXT;
  v_ag_types TEXT[] := ARRAY['TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'AI_DATA_PROCESSING', 'CHANNEL_OPERATION_DELEGATION'];
  v_ag_type TEXT;
  v_now TIMESTAMPTZ := now();
  v_saved_agreements INT := 0;
  v_state TEXT;
  v_final_business_number TEXT;
  v_final_company_name TEXT;
  v_final_representative_name TEXT;
  v_marketing_before BOOLEAN := NULL;
  v_marketing_modified BOOLEAN := false;
  v_required_modified TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- 1. Identity & Authorization Verification
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = 'P0001';
  END IF;

  -- When workspace_id is provided, verify caller owns that workspace
  IF p_workspace_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.workspaces WHERE id = p_workspace_id AND created_by = p_user_id
    ) AND NOT EXISTS (
      SELECT 1 FROM public.workspace_members WHERE workspace_id = p_workspace_id AND user_id = p_user_id AND role = 'owner' AND status = 'active'
    ) THEN
      RAISE EXCEPTION '해당 워크스페이스에 대한 소유 권한이 확인되지 않습니다 (WORKSPACE_OWNERSHIP_REQUIRED).'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_state := CASE WHEN p_is_verified THEN 'TASTE_READY' ELSE 'VERIFICATION_PENDING' END;
  v_clean_start_date := NULLIF(regexp_replace(COALESCE(p_start_date, ''), '[^0-9]', '', 'g'), '');

  -- 2. Lock & Upsert signup_applications (No arbitrary overwrite of existing authentic business data)
  SELECT * INTO v_app FROM public.signup_applications WHERE user_id = p_user_id FOR UPDATE;
  IF FOUND THEN
    -- Invariant: If application was already bound to a DIFFERENT workspace, reject reassignment!
    IF v_app.workspace_id IS NOT NULL AND p_workspace_id IS NOT NULL AND v_app.workspace_id <> p_workspace_id THEN
      RAISE EXCEPTION '신청서가 이미 다른 워크스페이스에 결합되어 있습니다 (WORKSPACE_MISMATCH_DENIED).'
        USING ERRCODE = '42501';
    END IF;

    -- Preserve existing authentic non-null fields
    v_final_business_number := COALESCE(v_app.business_number, NULLIF(btrim(p_business_number), ''));
    v_final_company_name := COALESCE(v_app.company_name, NULLIF(btrim(p_company_name), ''));
    v_final_representative_name := COALESCE(v_app.representative_name, NULLIF(btrim(p_representative_name), ''));

    UPDATE public.signup_applications
    SET
      workspace_id = COALESCE(p_workspace_id, v_app.workspace_id),
      business_number = v_final_business_number,
      company_name = v_final_company_name,
      representative_name = v_final_representative_name,
      state = CASE WHEN v_app.state = 'COMPLETED' THEN 'COMPLETED' ELSE v_state END,
      agreements_completed = true,
      updated_at = v_now
    WHERE user_id = p_user_id;
  ELSE
    v_final_business_number := NULLIF(btrim(p_business_number), '');
    v_final_company_name := NULLIF(btrim(p_company_name), '');
    v_final_representative_name := NULLIF(btrim(p_representative_name), '');

    INSERT INTO public.signup_applications (
      user_id, workspace_id, business_number, company_name, representative_name, state, agreements_completed, created_at, updated_at
    )
    VALUES (
      p_user_id, p_workspace_id, v_final_business_number, v_final_company_name, v_final_representative_name, v_state, true, v_now, v_now
    );
  END IF;

  -- 3. Save Required user_agreements with timestamp preservation on retry
  FOREACH v_ag_type IN ARRAY v_ag_types
  LOOP
    SELECT * INTO v_existing_ag FROM public.user_agreements
    WHERE user_id = p_user_id AND agreement_type = v_ag_type AND version = p_agreements_version;

    IF FOUND THEN
      IF v_existing_ag.workspace_id IS NOT NULL AND p_workspace_id IS NOT NULL AND v_existing_ag.workspace_id <> p_workspace_id THEN
        RAISE EXCEPTION '동의 내역이 이미 다른 워크스페이스에 결합되어 있습니다 (AGREEMENT_WORKSPACE_MISMATCH).'
          USING ERRCODE = '42501';
      END IF;

      IF v_existing_ag.agreed = true THEN
        -- Identical consent retry: preserve original agreed_at!
        UPDATE public.user_agreements
        SET workspace_id = COALESCE(p_workspace_id, user_agreements.workspace_id)
        WHERE id = v_existing_ag.id;
      ELSE
        -- Previously false, now agreeing: update agreed = true, agreed_at = v_now
        UPDATE public.user_agreements
        SET workspace_id = COALESCE(p_workspace_id, user_agreements.workspace_id), agreed = true, agreed_at = v_now, ip_address = COALESCE(p_ip_address, user_agreements.ip_address)
        WHERE id = v_existing_ag.id;
        v_required_modified := array_append(v_required_modified, v_ag_type);
      END IF;
    ELSE
      INSERT INTO public.user_agreements (
        workspace_id, user_id, agreement_type, version, agreed, agreed_at, ip_address
      )
      VALUES (
        p_workspace_id, p_user_id, v_ag_type, p_agreements_version, true, v_now, p_ip_address
      );
      v_required_modified := array_append(v_required_modified, v_ag_type);
    END IF;
    v_saved_agreements := v_saved_agreements + 1;
  END LOOP;

  -- 4. Optional marketingConsent (Distinguish omitted vs false vs true)
  IF p_marketing_agreed IS NOT NULL THEN
    SELECT * INTO v_existing_ag FROM public.user_agreements
    WHERE user_id = p_user_id AND agreement_type = 'MARKETING_NOTIFICATIONS' AND version = p_agreements_version;

    IF FOUND THEN
      IF v_existing_ag.workspace_id IS NOT NULL AND p_workspace_id IS NOT NULL AND v_existing_ag.workspace_id <> p_workspace_id THEN
        RAISE EXCEPTION '동의 내역이 이미 다른 워크스페이스에 결합되어 있습니다 (AGREEMENT_WORKSPACE_MISMATCH).'
          USING ERRCODE = '42501';
      END IF;

      v_marketing_before := v_existing_ag.agreed;
      IF v_existing_ag.agreed = p_marketing_agreed THEN
        -- Identical retry: preserve original agreed_at
        UPDATE public.user_agreements
        SET workspace_id = COALESCE(p_workspace_id, user_agreements.workspace_id)
        WHERE id = v_existing_ag.id;
      ELSE
        -- Changed consent status: update timestamp and agreed value
        UPDATE public.user_agreements
        SET workspace_id = COALESCE(p_workspace_id, user_agreements.workspace_id), agreed = p_marketing_agreed, agreed_at = v_now, ip_address = COALESCE(p_ip_address, user_agreements.ip_address)
        WHERE id = v_existing_ag.id;
        v_marketing_modified := true;
      END IF;
    ELSE
      INSERT INTO public.user_agreements (
        workspace_id, user_id, agreement_type, version, agreed, agreed_at, ip_address
      )
      VALUES (
        p_workspace_id, p_user_id, 'MARKETING_NOTIFICATIONS', p_agreements_version, p_marketing_agreed, v_now, p_ip_address
      );
      v_marketing_modified := true;
    END IF;
    v_saved_agreements := v_saved_agreements + 1;
  END IF;

  -- 5. Preserve start_date in business_verifications (when workspace_id is provided)
  IF p_workspace_id IS NOT NULL THEN
    SELECT * INTO v_bv FROM public.business_verifications WHERE workspace_id = p_workspace_id FOR UPDATE;
    IF FOUND THEN
      IF v_clean_start_date IS NOT NULL AND v_bv.start_date IS NULL THEN
        UPDATE public.business_verifications
        SET start_date = v_clean_start_date, updated_at = v_now
        WHERE workspace_id = p_workspace_id;
      END IF;
    ELSE
      IF v_final_business_number IS NOT NULL AND length(v_final_business_number) >= 10 THEN
        INSERT INTO public.business_verifications (
          workspace_id, business_number, company_name, representative_name, start_date, status, updated_at
        )
        VALUES (
          p_workspace_id, v_final_business_number, v_final_company_name, v_final_representative_name, v_clean_start_date, CASE WHEN p_is_verified THEN 'VERIFIED' ELSE 'PENDING' END, v_now
        )
        ON CONFLICT (workspace_id) DO UPDATE SET
          start_date = COALESCE(public.business_verifications.start_date, EXCLUDED.start_date),
          updated_at = v_now;
      END IF;
    END IF;

    SELECT start_date INTO v_stored_start_date FROM public.business_verifications WHERE workspace_id = p_workspace_id;
    v_start_date_saved := (v_stored_start_date IS NOT NULL AND v_clean_start_date IS NOT NULL AND v_stored_start_date = v_clean_start_date);

    -- 6. Record immutable audit event in platform_audit_events (Zero PII in payload)
    v_audit_idem := encode(extensions.digest('signup-atomic:' || p_user_id::text || ':' || p_workspace_id::text || ':' || v_now::text, 'sha256'), 'hex');

    INSERT INTO public.platform_audit_events (
      actor_user_id, workspace_id, action, target_type, target_id, reason,
      request_id, result, fact_kind, before, after, idempotency_key
    )
    VALUES (
      p_user_id,
      p_workspace_id,
      'agreement.verify.requested',
      'signup_application',
      p_workspace_id::text,
      '회원가입 정보 및 약관 동의 원자적 확정',
      'reg-atomic-' || substr(v_audit_idem, 1, 20),
      'succeeded',
      'user_claim',
      jsonb_build_object(
        'state', coalesce(v_app.state, 'NONE'),
        'workspace_id', v_app.workspace_id,
        'marketing_agreed', v_marketing_before
      ),
      jsonb_build_object(
        'state', v_state,
        'workspace_id', p_workspace_id,
        'agreements_saved_count', v_saved_agreements,
        'marketing_agreed', p_marketing_agreed,
        'marketing_modified', v_marketing_modified,
        'required_agreements_modified', v_required_modified,
        'is_verified', p_is_verified
      ),
      v_audit_idem
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'workspace_id', p_workspace_id,
    'user_id', p_user_id,
    'agreements_saved_count', v_saved_agreements,
    'start_date_saved', v_start_date_saved,
    'stored_start_date', v_stored_start_date,
    'is_verified', p_is_verified
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_email_signup_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_email_signup_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT) TO service_role;
COMMENT ON FUNCTION public.finalize_email_signup_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT) IS
  'Atomically save email registration agreements, signup_applications workspace link, start_date, and audit invariant without partial state. Server service_role ONLY.';
