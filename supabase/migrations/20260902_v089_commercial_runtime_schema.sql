-- ============================================================================
-- Sohee V0.8.9 & Admin V0.3 Commercial Autonomous Agent Runtime Migration
-- Conforms to Supabase Security Checklist:
-- 1. Explicit RLS enabled on all exposed tables.
-- 2. Uses TO authenticated / TO anon instead of deprecated auth.role().
-- 3. Combines TO authenticated with ownership checks ((select auth.uid()) = user_id).
-- 4. UPDATE policies provide both USING and WITH CHECK.
-- 5. Functions created with SECURITY INVOKER by default.
-- ============================================================================

-- 1. Business Verifications
CREATE TABLE IF NOT EXISTS public.business_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  business_number VARCHAR(10) NOT NULL,
  company_name TEXT NOT NULL,
  representative_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'DOCUMENT_REQUIRED')),
  rejection_reason TEXT,
  document_url TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_business_workspace UNIQUE (workspace_id)
);

ALTER TABLE public.business_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "business_verifications_select"
ON public.business_verifications FOR SELECT
TO authenticated
USING (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_memberships WHERE user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "business_verifications_insert"
ON public.business_verifications FOR INSERT
TO authenticated
WITH CHECK (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_memberships WHERE user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "business_verifications_update"
ON public.business_verifications FOR UPDATE
TO authenticated
USING (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_memberships WHERE user_id = (SELECT auth.uid())
  )
)
WITH CHECK (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_memberships WHERE user_id = (SELECT auth.uid())
  )
);

-- 2. Versioned Legal Agreements
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

CREATE POLICY "user_agreements_select"
ON public.user_agreements FOR SELECT
TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY "user_agreements_insert"
ON public.user_agreements FOR INSERT
TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()));

-- 3. Trial & Credit Entitlements
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

CREATE POLICY "workspace_credit_states_select"
ON public.workspace_credit_states FOR SELECT
TO authenticated
USING (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_memberships WHERE user_id = (SELECT auth.uid())
  )
);

-- 4. External Action Receipts (Runtime Truth)
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

CREATE POLICY "external_action_receipts_select"
ON public.external_action_receipts FOR SELECT
TO authenticated
USING (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_memberships WHERE user_id = (SELECT auth.uid())
  )
);

-- 5. Privileged Support Sessions & Audit
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

-- 6. FinOps Cost Ledger
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
