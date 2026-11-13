-- ============================================================================
-- Sohee V0.8.9 & Admin V0.3 Production Truth Recovery & Complete Schema
-- Epic: ANI-553 (Production Truth Recovery / false-complete 재오픈 / Release Gate)
-- ============================================================================

-- 1. Business Verifications (ANI-555)
CREATE TABLE IF NOT EXISTS public.business_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  business_number VARCHAR(10) NOT NULL,
  company_name TEXT NOT NULL,
  representative_name TEXT NOT NULL,
  start_date VARCHAR(8),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'DOCUMENT_REQUIRED', 'MISMATCH')),
  rejection_reason TEXT,
  document_url TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_business_workspace UNIQUE (workspace_id)
);

ALTER TABLE public.business_verifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_verifications' AND policyname = 'business_verifications_select') THEN
    CREATE POLICY "business_verifications_select" ON public.business_verifications FOR SELECT TO authenticated
    USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_verifications' AND policyname = 'business_verifications_insert') THEN
    CREATE POLICY "business_verifications_insert" ON public.business_verifications FOR INSERT TO authenticated
    WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_verifications' AND policyname = 'business_verifications_update') THEN
    CREATE POLICY "business_verifications_update" ON public.business_verifications FOR UPDATE TO authenticated
    USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())))
    WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())));
  END IF;
END $$;

-- 2. Signup Applications (Formal Signup State Machine: ANI-554)
CREATE TABLE IF NOT EXISTS public.signup_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'FORM_REQUIRED' CHECK (state IN ('FORM_REQUIRED', 'BUSINESS_PENDING', 'AGREEMENT_REQUIRED', 'TRIAL_READY', 'COMPLETED', 'REJECTED')),
  business_number VARCHAR(10),
  company_name TEXT,
  representative_name TEXT,
  agreements_completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_signup_user UNIQUE (user_id)
);

ALTER TABLE public.signup_applications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'signup_applications' AND policyname = 'signup_applications_all') THEN
    CREATE POLICY "signup_applications_all" ON public.signup_applications FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));
  END IF;
END $$;

-- 3. Versioned Legal Agreements (ANI-557)
CREATE TABLE IF NOT EXISTS public.user_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agreement_type TEXT NOT NULL,
  version TEXT NOT NULL,
  agreed BOOLEAN NOT NULL DEFAULT true,
  agreed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address TEXT,
  CONSTRAINT uq_user_agreement UNIQUE (workspace_id, user_id, agreement_type, version)
);

ALTER TABLE public.user_agreements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_agreements' AND policyname = 'user_agreements_select') THEN
    CREATE POLICY "user_agreements_select" ON public.user_agreements FOR SELECT TO authenticated
    USING (user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_agreements' AND policyname = 'user_agreements_insert') THEN
    CREATE POLICY "user_agreements_insert" ON public.user_agreements FOR INSERT TO authenticated
    WITH CHECK (user_id = (SELECT auth.uid()));
  END IF;
END $$;

-- 4. Trial Entitlements (ANI-556, ANI-562)
CREATE TABLE IF NOT EXISTS public.trial_entitlements (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_key TEXT NOT NULL DEFAULT 'TRIAL_V1',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'CONVERTED', 'REVOKED')),
  initial_credit_grant INTEGER NOT NULL DEFAULT 40000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.trial_entitlements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'trial_entitlements' AND policyname = 'trial_entitlements_select') THEN
    CREATE POLICY "trial_entitlements_select" ON public.trial_entitlements FOR SELECT TO authenticated
    USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())));
  END IF;
END $$;

-- 5. Workspace Credit States (Bucketed Credits: ANI-527)
CREATE TABLE IF NOT EXISTS public.workspace_credit_states (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  commercial_state TEXT NOT NULL DEFAULT 'TRIAL_ACTIVE' CHECK (commercial_state IN ('TRIAL_ACTIVE', 'PAID_PENDING', 'ACTIVE', 'GRACE', 'PAST_DUE', 'CANCEL', 'EXPIRED')),
  trial_started_at TIMESTAMPTZ DEFAULT now(),
  trial_ends_at TIMESTAMPTZ,
  activation_credits INTEGER NOT NULL DEFAULT 5000,
  agent_credits INTEGER NOT NULL DEFAULT 25000,
  protected_wow_credits INTEGER NOT NULL DEFAULT 10000,
  purchased_credits INTEGER NOT NULL DEFAULT 0,
  total_available_credits INTEGER NOT NULL DEFAULT 40000,
  is_grace_period BOOLEAN NOT NULL DEFAULT false,
  grace_ends_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_credit_states ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'workspace_credit_states' AND policyname = 'workspace_credit_states_select') THEN
    CREATE POLICY "workspace_credit_states_select" ON public.workspace_credit_states FOR SELECT TO authenticated
    USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())));
  END IF;
END $$;

-- 6. External Action Receipts (ANI-558, ANI-559)
CREATE TABLE IF NOT EXISTS public.external_action_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'PROCESSING', 'ACCEPTED_BY_PROVIDER', 'VERIFIED', 'FAILED', 'ACTION_REQUIRED')),
  external_content_id TEXT,
  external_url TEXT,
  screenshot_evidence_url TEXT,
  verification_method TEXT NOT NULL,
  verified_at TIMESTAMPTZ,
  evidence_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.external_action_receipts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'external_action_receipts' AND policyname = 'external_action_receipts_select') THEN
    CREATE POLICY "external_action_receipts_select" ON public.external_action_receipts FOR SELECT TO authenticated
    USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())));
  END IF;
END $$;

-- 7. Privileged Support Sessions & Kill Switches (ANI-549, ANI-550)
CREATE TABLE IF NOT EXISTS public.privileged_support_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  admin_user_id UUID NOT NULL REFERENCES auth.users(id),
  reason TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  actions_performed JSONB DEFAULT '[]'::jsonb
);

ALTER TABLE public.privileged_support_sessions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.kill_switches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('GLOBAL', 'WORKSPACE', 'PROVIDER')),
  target_id TEXT,
  reason TEXT NOT NULL,
  engaged_by UUID NOT NULL REFERENCES auth.users(id),
  engaged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE public.kill_switches ENABLE ROW LEVEL SECURITY;

-- 8. FinOps Cost Ledger (ANI-565)
CREATE TABLE IF NOT EXISTS public.finops_cost_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  cost_in_won NUMERIC(12, 2) NOT NULL DEFAULT 0,
  units_consumed NUMERIC(12, 4) NOT NULL DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.finops_cost_ledger ENABLE ROW LEVEL SECURITY;

-- 9. Atomic Bootstrap RPC (ANI-556, Solves 404 & 403 on Google OAuth)
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
  v_starts_at TIMESTAMPTZ := now();
  v_ends_at TIMESTAMPTZ := now() + interval '14 days';
BEGIN
  -- 1. Check existing workspace
  SELECT workspace_id INTO v_existing_ws_id
  FROM public.workspace_members
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_existing_ws_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'workspace_id', v_existing_ws_id,
      'is_new_trial', false
    );
  END IF;

  -- 2. Create workspace
  INSERT INTO public.workspaces (name, created_by)
  VALUES (COALESCE(p_workspace_name, '나의 소희 마케팅'), p_user_id)
  RETURNING id INTO v_new_ws_id;

  -- 3. Add workspace member as owner
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_new_ws_id, p_user_id, 'owner');

  -- 4. Upsert business_profiles
  INSERT INTO public.business_profiles (workspace_id, business_name, summary, updated_at)
  VALUES (v_new_ws_id, COALESCE(p_workspace_name, '나의 소희 마케팅'), '신규 가입 매장', now())
  ON CONFLICT (workspace_id) DO NOTHING;

  -- 5. Create credit account
  INSERT INTO public.credit_accounts (workspace_id, period_start, period_end, timezone)
  VALUES (v_new_ws_id, CURRENT_DATE, (CURRENT_DATE + interval '14 days')::date, 'Asia/Seoul')
  RETURNING id INTO v_credit_acc_id;

  -- 6. Insert 14-day 40,000 SC grant into credit_ledger_entries (Strict schema compliant)
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

  -- 7. Insert trial_entitlements
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

  -- 8. Insert workspace_credit_states (Bucketed credits)
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

  RETURN jsonb_build_object(
    'success', true,
    'workspace_id', v_new_ws_id,
    'is_new_trial', true
  );
END;
$$;

-- Grant execution of bootstrap_workspace_trial to authenticated and anon (for signup flow)
GRANT EXECUTE ON FUNCTION public.bootstrap_workspace_trial TO authenticated, anon, service_role;
