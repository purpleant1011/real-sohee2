-- ============================================================================
-- Sohee V0.8.8 3rd Revision Foundation Migration
-- Master Spec Reference: Docs 00~09
-- Epic A, B, F Foundation: Business Profiles, 6,000 SC Trial, Shared Truth & Benefit Campaigns
-- ============================================================================

-- 1. Business Profiles & Eligibility (사업자 전용 자격 정본)
CREATE TABLE IF NOT EXISTS public.business_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  registration_number TEXT NOT NULL, -- 사업자등록번호 (10자리)
  representative_name TEXT NOT NULL,
  category TEXT NOT NULL, -- 업종/세부 서비스
  address TEXT, -- 사업장 주소 또는 영업 지역
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

CREATE INDEX IF NOT EXISTS idx_business_profiles_workspace ON public.business_profiles(workspace_id, verification_status);
CREATE INDEX IF NOT EXISTS idx_business_profiles_reg_number ON public.business_profiles(registration_number);

-- 2. Business Verification Events (사업자 검증 심사 감사 이력)
CREATE TABLE IF NOT EXISTS public.business_verification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  reviewer_id UUID,
  reason TEXT,
  evidence_source TEXT NOT NULL DEFAULT 'MANUAL_REVIEW', -- 'MANUAL_REVIEW', 'SYSTEM_PROVISIONAL', 'EXTERNAL_API'
  evidence_payload JSONB DEFAULT '{}'::jsonb,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_verification_events_workspace ON public.business_verification_events(workspace_id);

-- 3. Trial Entitlements Upgrade (14일 6,000 SC 정본 승격)
ALTER TABLE IF EXISTS public.trial_entitlements 
  ALTER COLUMN initial_credit_grant SET DEFAULT 6000;

-- 4. Benefit Campaigns & Grants & Coupons (관리자 혜택 및 선물 정본)
CREATE TABLE IF NOT EXISTS public.benefit_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('PROMO_CREDIT', 'COUPON', 'TRIAL_EXTENSION', 'COMPENSATION', 'WELCOME_GIFT', 'MILESTONE_CELEBRATION')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  audience_rule JSONB NOT NULL DEFAULT '{"target": "ALL_ACTIVE"}'::jsonb,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  budget_cap_sc BIGINT,
  per_workspace_sc BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'STOPPED', 'CANCELLED')),
  created_by UUID NOT NULL,
  approved_by UUID,
  total_recipients_count INTEGER DEFAULT 0,
  granted_recipients_count INTEGER DEFAULT 0,
  total_granted_sc BIGINT DEFAULT 0,
  estimated_cogs_krw BIGINT DEFAULT 0,
  realized_cogs_krw BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_benefit_campaigns_status ON public.benefit_campaigns(status, type);

CREATE TABLE IF NOT EXISTS public.benefit_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.benefit_campaigns(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'GRANTED', 'FAILED', 'REDEEMED', 'EXPIRED', 'REVERSED')),
  granted_sc BIGINT NOT NULL DEFAULT 0,
  granted_at TIMESTAMPTZ,
  redeemed_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  ledger_entry_id UUID,
  idempotency_key TEXT NOT NULL UNIQUE,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_benefit_grants_workspace ON public.benefit_grants(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_benefit_grants_campaign ON public.benefit_grants(campaign_id);

CREATE TABLE IF NOT EXISTS public.coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES public.benefit_campaigns(id) ON DELETE SET NULL,
  code TEXT NOT NULL UNIQUE,
  benefit_type TEXT NOT NULL CHECK (benefit_type IN ('CREDIT_DISCOUNT', 'CREDIT_GRANT', 'SUBSCRIPTION_DISCOUNT')),
  value_amount BIGINT NOT NULL DEFAULT 0,
  eligible_plans JSONB DEFAULT '["TRIAL_V1", "GROWTH", "SCALE"]'::jsonb,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  max_redemptions INTEGER NOT NULL DEFAULT 1,
  redemption_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXHAUSTED', 'EXPIRED', 'DISABLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON public.coupons(code, status);

-- 5. RLS Policies
ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_verification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.benefit_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.benefit_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

-- Customer RLS: 소속 워크스페이스만 조회 가능
CREATE POLICY "Customers view own business_profile"
  ON public.business_profiles FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.memberships WHERE memberships.workspace_id = business_profiles.workspace_id AND memberships.user_id = auth.uid()));

CREATE POLICY "Customers update own business_profile"
  ON public.business_profiles FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.memberships WHERE memberships.workspace_id = business_profiles.workspace_id AND memberships.user_id = auth.uid() AND memberships.role IN ('owner', 'admin')));

CREATE POLICY "Customers view own benefit_grants"
  ON public.benefit_grants FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.memberships WHERE memberships.workspace_id = benefit_grants.workspace_id AND memberships.user_id = auth.uid()));

-- 6. Legacy 500 SC Cohort Migration Procedure (기존 500 SC 받은 워크스페이스에 +5,500 SC 보정 원장 지급)
CREATE OR REPLACE FUNCTION public.migrate_legacy_500_trial_cohort()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_migrated_count INTEGER := 0;
  r RECORD;
BEGIN
  FOR r IN 
    SELECT te.workspace_id, te.ends_at
    FROM public.trial_entitlements te
    WHERE te.initial_credit_grant = 500 AND te.status = 'ACTIVE'
  LOOP
    -- 1. trial_entitlements 업데이트
    UPDATE public.trial_entitlements
    SET initial_credit_grant = 6000,
        updated_at = NOW()
    WHERE workspace_id = r.workspace_id;

    -- 2. 보정 원장 삽입 (+5,500 SC)
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
    SELECT 
      r.workspace_id,
      'PROMO_CREDIT',
      'trial_upgrade_6000_sc',
      5500,
      COALESCE((SELECT balance_after FROM public.credit_ledger_entries WHERE workspace_id = r.workspace_id ORDER BY created_at DESC LIMIT 1), 500) + 5500,
      'migration:500-to-6000:' || r.workspace_id::text,
      '소희 V0.8.8 3차 수정: 14일 무료체험 6,000 SC 정본 승격 보정 지급 (+5,500 SC)',
      r.ends_at,
      NOW()
    ON CONFLICT (idempotency_key) DO NOTHING;

    v_migrated_count := v_migrated_count + 1;
  END LOOP;

  RETURN v_migrated_count;
END;
$$;
