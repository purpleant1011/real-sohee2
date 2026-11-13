-- ============================================================================
-- Sohee V0.2 1st Refinement Contracts Migration
-- Tables: consent_receipts, channel_authorizations, capability_grants, trial_entitlements, signup_bootstrap_events
-- RPC: bootstrap_workspace_trial, get_my_channel_authorizations
-- ============================================================================

-- 1. ConsentReceipts (법적/서비스 동의 이력 - Immutable)
CREATE TABLE IF NOT EXISTS public.consent_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_version_id TEXT NOT NULL,
  consent_type TEXT NOT NULL, -- "TERMS_OF_SERVICE", "PRIVACY_POLICY", "PUBLISHING_DELEGATION", "CRM_AUTOMATION"
  channel TEXT, -- NULL (global) or "META_INSTAGRAM", "META_THREADS", "NAVER_BLOG", "DANGGEUN"
  scopes JSONB DEFAULT "[]" :: JSONB,
  status TEXT NOT NULL DEFAULT "ACTIVE" CHECK (status IN ("ACTIVE", "WITHDRAWN", "EXPIRED", "RECONSENT_REQUIRED")),
  accepted_by UUID NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  withdrawn_at TIMESTAMPTZ,
  evidence_hash TEXT,
  policy_version TEXT NOT NULL DEFAULT "v1",
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consent_receipts_workspace ON public.consent_receipts(workspace_id, status);

-- 2. ChannelAuthorizations (멀티테넌트 채널 인가 상태)
CREATE TABLE IF NOT EXISTS public.channel_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ("META_INSTAGRAM", "META_THREADS", "NAVER_BROWSER", "DANGGEUN_BROWSER")),
  external_account_id TEXT,
  account_label TEXT,
  account_type TEXT,
  status TEXT NOT NULL DEFAULT "CONNECTED" CHECK (status IN ("CONNECTED", "REAUTH_REQUIRED", "REVOKED", "DEGRADED", "DISCONNECTED")),
  granted_scopes JSONB DEFAULT "[]" :: JSONB,
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_validated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consent_receipt_id UUID REFERENCES public.consent_receipts(id),
  capability_snapshot_version TEXT DEFAULT "v1",
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channel_authorizations_workspace ON public.channel_authorizations(workspace_id, provider, status);

-- 3. CapabilityGrants (실제 실행 가능한 행동 권한)
CREATE TABLE IF NOT EXISTS public.capability_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id UUID NOT NULL REFERENCES public.channel_authorizations(id) ON DELETE CASCADE,
  capability_key TEXT NOT NULL, -- e.g. "INSTAGRAM_PUBLISH_FEED", "THREADS_PUBLISH", "NAVER_BLOG_POST"
  status TEXT NOT NULL DEFAULT "ENABLED" CHECK (status IN ("ENABLED", "DISABLED", "UNAVAILABLE", "UNKNOWN")),
  reason_code TEXT,
  derived_from_scope TEXT,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_capability_grants_auth ON public.capability_grants(authorization_id, capability_key);

-- 4. TrialEntitlements (14일 500 SC 무료체험 권한 관리)
CREATE TABLE IF NOT EXISTS public.trial_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_key TEXT NOT NULL DEFAULT "TRIAL_V1",
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT "ACTIVE" CHECK (status IN ("ACTIVE", "EXPIRED", "CONVERTED", "REVOKED")),
  initial_credit_grant INTEGER NOT NULL DEFAULT 500,
  created_from_signup_event_id TEXT,
  converted_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trial_entitlements_workspace ON public.trial_entitlements(workspace_id, status);

-- 5. SignupBootstrapEvents (가입 온보딩 감사 이력)
CREATE TABLE IF NOT EXISTS public.signup_bootstrap_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL,
  provider TEXT NOT NULL DEFAULT "google",
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT "COMPLETED",
  safe_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS 활성화
ALTER TABLE public.consent_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capability_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signup_bootstrap_events ENABLE ROW LEVEL SECURITY;

-- Customer RLS: 소속 워크스페이스만 조회 가능
CREATE POLICY "Customers can view consent_receipts in their workspaces"
  ON public.consent_receipts FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.memberships WHERE memberships.workspace_id = consent_receipts.workspace_id AND memberships.user_id = auth.uid()));

CREATE POLICY "Customers can view channel_authorizations in their workspaces"
  ON public.channel_authorizations FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.memberships WHERE memberships.workspace_id = channel_authorizations.workspace_id AND memberships.user_id = auth.uid()));

CREATE POLICY "Customers can view trial_entitlements in their workspaces"
  ON public.trial_entitlements FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.memberships WHERE memberships.workspace_id = trial_entitlements.workspace_id AND memberships.user_id = auth.uid()));
