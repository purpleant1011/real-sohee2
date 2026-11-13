-- ============================================================================
-- Sohee V0.8.8 3rd Revision Master Canonical Schema Refinement
-- Spec Reference: Docs 00 ~ 09 (User App <-> Admin Control Plane <-> Supabase DB Single Source of Truth)
-- ============================================================================

-- 1. Ensure Workspaces & Memberships Schema Parity
CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED', 'TERMINATED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON public.workspace_members(user_id, workspace_id);

-- 2. Business Profiles & Verification State (사업자 전용 자격 정본)
CREATE TABLE IF NOT EXISTS public.business_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  registration_number TEXT NOT NULL,
  representative_name TEXT NOT NULL,
  category TEXT NOT NULL,
  address TEXT,
  contact_phone TEXT NOT NULL,
  website_url TEXT,
  operating_hours JSONB DEFAULT '{}'::jsonb,
  verification_status TEXT NOT NULL DEFAULT 'INCOMPLETE' CHECK (verification_status IN ('INCOMPLETE', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED')),
  service_eligibility TEXT NOT NULL DEFAULT 'LIMITED' CHECK (service_eligibility IN ('BLOCKED', 'LIMITED', 'ELIGIBLE')),
  verified_at TIMESTAMPTZ,
  reviewed_by UUID,
  rejection_reason TEXT,
  evidence_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_profiles_ws ON public.business_profiles(workspace_id, verification_status);
CREATE INDEX IF NOT EXISTS idx_business_profiles_reg ON public.business_profiles(registration_number);

-- 3. Trial Entitlements (14일 6,000 SC 정본)
CREATE TABLE IF NOT EXISTS public.trial_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL DEFAULT 'TRIAL_V1',
  initial_credit_grant BIGINT NOT NULL DEFAULT 6000,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'CONVERTED', 'SUSPENDED')),
  converted_to_plan TEXT,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trial_entitlements_status ON public.trial_entitlements(status, ends_at);

-- 4. Credit Ledger Entries (원장 정본)
CREATE TABLE IF NOT EXISTS public.credit_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'TRIAL_GRANT' CHECK (kind IN ('TRIAL_GRANT', 'PROMO_CREDIT', 'SUBSCRIPTION_GRANT', 'MISSION_USAGE', 'REFUND_COMPENSATION', 'EXPIRATION_SETTLEMENT')),
  action TEXT NOT NULL,
  amount BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_ws_time ON public.credit_ledger_entries(workspace_id, created_at DESC);

-- 5. Channel Authorizations (채널 연동 및 위임 동의 단일 정본)
CREATE TABLE IF NOT EXISTS public.channel_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('INSTAGRAM', 'THREADS', 'NAVER_BLOG', 'NAVER_PLACE', 'DANGGEUN', 'KAKAO_TALK')),
  status TEXT NOT NULL DEFAULT 'CONNECTED' CHECK (status IN ('CONNECTED', 'REAUTH_REQUIRED', 'DISCONNECTED', 'REVOKED')),
  account_identifier TEXT NOT NULL,
  account_name TEXT,
  token_expires_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_channel_auth_ws ON public.channel_authorizations(workspace_id, channel, status);

-- 6. Atomic RPC: bootstrap_workspace_trial (신규 가입자 원자적 1회 부트스트랩)
CREATE OR REPLACE FUNCTION public.bootstrap_workspace_trial(
  p_user_id UUID,
  p_business_name TEXT DEFAULT '나의 소희 마케팅'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id UUID;
  v_trial_id UUID;
  v_now TIMESTAMPTZ := NOW();
  v_ends_at TIMESTAMPTZ := NOW() + INTERVAL '14 days';
BEGIN
  -- 1. Check if user already has an active workspace membership
  SELECT wm.workspace_id INTO v_workspace_id
  FROM public.workspace_members wm
  WHERE wm.user_id = p_user_id
  ORDER BY wm.created_at ASC
  LIMIT 1;

  IF v_workspace_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'workspace_id', v_workspace_id,
      'is_new', false,
      'status', 'EXISTING'
    );
  END IF;

  -- 2. Create Workspace
  INSERT INTO public.workspaces (name, status, created_at, updated_at)
  VALUES (COALESCE(p_business_name, '나의 소희 마케팅'), 'ACTIVE', v_now, v_now)
  RETURNING id INTO v_workspace_id;

  -- 3. Create Workspace Member (Owner)
  INSERT INTO public.workspace_members (workspace_id, user_id, role, status, created_at, updated_at)
  VALUES (v_workspace_id, p_user_id, 'owner', 'active', v_now, v_now);

  -- 4. Create Business Profile (INCOMPLETE status for First Wow Onboarding)
  INSERT INTO public.business_profiles (
    workspace_id,
    business_name,
    registration_number,
    representative_name,
    category,
    contact_phone,
    verification_status,
    service_eligibility,
    created_at,
    updated_at
  )
  VALUES (
    v_workspace_id,
    COALESCE(p_business_name, '나의 소희 마케팅'),
    '000-00-00000',
    '대표자명 미등록',
    '미분류',
    '010-0000-0000',
    'INCOMPLETE',
    'LIMITED',
    v_now,
    v_now
  );

  -- 5. Create Trial Entitlements (14일 6,000 SC)
  INSERT INTO public.trial_entitlements (
    workspace_id,
    plan_id,
    initial_credit_grant,
    starts_at,
    ends_at,
    status,
    created_at,
    updated_at
  )
  VALUES (
    v_workspace_id,
    'TRIAL_V1',
    6000,
    v_now,
    v_ends_at,
    'ACTIVE',
    v_now,
    v_now
  )
  RETURNING id INTO v_trial_id;

  -- 6. Insert Initial Credit Ledger Entry (+6,000 SC)
  INSERT INTO public.credit_ledger_entries (
    workspace_id,
    kind,
    action,
    amount,
    balance_after,
    idempotency_key,
    description,
    expires_at,
    created_at
  )
  VALUES (
    v_workspace_id,
    'TRIAL_GRANT',
    'initial_trial_bootstrap_6000_sc',
    6000,
    6000,
    'trial-bootstrap:' || v_workspace_id::text,
    '소희 14일 무료 체험 가입 축하 6,000 SC 지급',
    v_ends_at,
    v_now
  );

  RETURN jsonb_build_object(
    'workspace_id', v_workspace_id,
    'trial_id', v_trial_id,
    'is_new', true,
    'initial_credits', 6000,
    'ends_at', v_ends_at,
    'status', 'BOOTSTRAPPED'
  );
END;
$$;

-- 7. Customer Safe Read RPCs
CREATE OR REPLACE FUNCTION public.get_my_workspace_summary(p_workspace_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_member BOOLEAN;
  v_workspace RECORD;
  v_profile RECORD;
  v_trial RECORD;
  v_balance BIGINT;
BEGIN
  -- Security check: Verify caller is a member
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = p_workspace_id AND user_id = auth.uid()
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'Access Denied: You are not a member of this workspace';
  END IF;

  SELECT * INTO v_workspace FROM public.workspaces WHERE id = p_workspace_id;
  SELECT * INTO v_profile FROM public.business_profiles WHERE workspace_id = p_workspace_id;
  SELECT * INTO v_trial FROM public.trial_entitlements WHERE workspace_id = p_workspace_id;
  
  SELECT COALESCE(balance_after, 6000) INTO v_balance
  FROM public.credit_ledger_entries
  WHERE workspace_id = p_workspace_id
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'workspace', jsonb_build_object('id', v_workspace.id, 'name', v_workspace.name, 'status', v_workspace.status),
    'profile', jsonb_build_object(
      'business_name', v_profile.business_name,
      'registration_number', v_profile.registration_number,
      'representative_name', v_profile.representative_name,
      'category', v_profile.category,
      'verification_status', v_profile.verification_status,
      'service_eligibility', v_profile.service_eligibility
    ),
    'trial', jsonb_build_object(
      'plan_id', COALESCE(v_trial.plan_id, 'TRIAL_V1'),
      'starts_at', v_trial.starts_at,
      'ends_at', v_trial.ends_at,
      'status', COALESCE(v_trial.status, 'ACTIVE')
    ),
    'credit_balance', COALESCE(v_balance, 6000)
  );
END;
$$;

-- 8. Enable Row Level Security on All Tables
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_authorizations ENABLE ROW LEVEL SECURITY;

-- 9. Customer Multi-Tenant Isolation RLS Policies
DROP POLICY IF EXISTS "Members view own workspace" ON public.workspaces;
CREATE POLICY "Members view own workspace"
  ON public.workspaces FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = workspaces.id AND wm.user_id = auth.uid()));

DROP POLICY IF EXISTS "Members view own workspace_members" ON public.workspace_members;
CREATE POLICY "Members view own workspace_members"
  ON public.workspace_members FOR SELECT
  TO authenticated
  USING (workspace_id IN (SELECT wm2.workspace_id FROM public.workspace_members wm2 WHERE wm2.user_id = auth.uid()));

DROP POLICY IF EXISTS "Members view own business_profile" ON public.business_profiles;
CREATE POLICY "Members view own business_profile"
  ON public.business_profiles FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = business_profiles.workspace_id AND wm.user_id = auth.uid()));

DROP POLICY IF EXISTS "Admins update own business_profile" ON public.business_profiles;
CREATE POLICY "Admins update own business_profile"
  ON public.business_profiles FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = business_profiles.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('owner', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = business_profiles.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('owner', 'admin')));

DROP POLICY IF EXISTS "Members view own trial_entitlements" ON public.trial_entitlements;
CREATE POLICY "Members view own trial_entitlements"
  ON public.trial_entitlements FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = trial_entitlements.workspace_id AND wm.user_id = auth.uid()));

DROP POLICY IF EXISTS "Members view own credit_ledger_entries" ON public.credit_ledger_entries;
CREATE POLICY "Members view own credit_ledger_entries"
  ON public.credit_ledger_entries FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = credit_ledger_entries.workspace_id AND wm.user_id = auth.uid()));

DROP POLICY IF EXISTS "Members view own channel_authorizations" ON public.channel_authorizations;
CREATE POLICY "Members view own channel_authorizations"
  ON public.channel_authorizations FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = channel_authorizations.workspace_id AND wm.user_id = auth.uid()));
