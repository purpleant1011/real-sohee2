-- ============================================================================
-- Migration: 20260905000000_v09_truth_model_commercial_expansion.sql
-- Issues:
--   [ANI-707] Supabase V0.9 Truth Model 전체 gap closure + RLS/lifecycle/preflight
--   [ANI-673] Agent Energy Ledger & Budget Reservation/Cost Guardrail
--   [ANI-679] ₩150k/₩300k/₩500k Agent Energy Plan/Entitlement Packaging
--   [ANI-681] Supabase V0.9 Additive Truth Model + RLS/Migration Contract
-- ============================================================================

-- 1. commercial_plan_versions
CREATE TABLE IF NOT EXISTS public.commercial_plan_versions (
  plan_version_id text PRIMARY KEY,
  plan_tier text NOT NULL, -- 'FREE_TASTE', 'PAID_150', 'PAID_300', 'PAID_500'
  name text NOT NULL,
  price_krw integer NOT NULL DEFAULT 0,
  included_energy integer NOT NULL DEFAULT 50,
  free_taste_cost_budget_krw integer NOT NULL DEFAULT 5000,
  target_margin_percent integer NOT NULL DEFAULT 70,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.commercial_plan_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.commercial_plan_versions FROM anon, public;
GRANT ALL ON TABLE public.commercial_plan_versions TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'commercial_plan_versions' AND policyname = 'commercial_plan_versions_read_auth'
  ) THEN
    CREATE POLICY commercial_plan_versions_read_auth ON public.commercial_plan_versions
      FOR SELECT TO authenticated
      USING (is_active = true);
  END IF;
END $$;

-- 기본 플랜 시드 데이터
INSERT INTO public.commercial_plan_versions (plan_version_id, plan_tier, name, price_krw, included_energy, free_taste_cost_budget_krw, target_margin_percent)
VALUES
  ('plan_free_taste_v1', 'FREE_TASTE', '소희 Free Taste 체험팩 (₩5,000 상당)', 0, 50, 5000, 100),
  ('plan_starter_150k_v1', 'PAID_150', '소희 스타터 플랜 (Starter)', 150000, 1500, 0, 75),
  ('plan_growth_300k_v1', 'PAID_300', '소희 그로스 플랜 (Growth)', 300000, 3000, 0, 75),
  ('plan_pro_500k_v1', 'PAID_500', '소희 프로 스케일 플랜 (Pro Scale)', 500000, 5000, 0, 80)
ON CONFLICT (plan_version_id) DO UPDATE
SET
  name = EXCLUDED.name,
  price_krw = EXCLUDED.price_krw,
  included_energy = EXCLUDED.included_energy;

-- 2. workspace_entitlements
CREATE TABLE IF NOT EXISTS public.workspace_entitlements (
  entitlement_id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_version_id text NOT NULL REFERENCES public.commercial_plan_versions(plan_version_id),
  plan_tier text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'EXHAUSTED', 'SUSPENDED', 'PAST_DUE'
  source text NOT NULL DEFAULT 'FREE_TASTE_GRANT', -- 'FREE_TASTE_GRANT', 'PAYMENT_VERIFIED', 'ADMIN_MANUAL'
  activated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_entitlements_ws
  ON public.workspace_entitlements (workspace_id, status);

ALTER TABLE public.workspace_entitlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.workspace_entitlements FROM anon, public;
GRANT ALL ON TABLE public.workspace_entitlements TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workspace_entitlements' AND policyname = 'workspace_entitlements_tenant_isolation'
  ) THEN
    CREATE POLICY workspace_entitlements_tenant_isolation ON public.workspace_entitlements
      FOR ALL TO authenticated
      USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
        )
      );
  END IF;
END $$;

-- 3. energy_grants (Anti-Abuse Exactly-Once Grant)
CREATE TABLE IF NOT EXISTS public.energy_grants (
  grant_id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  grant_type text NOT NULL, -- 'FREE_TASTE', 'TOP_UP', 'ADMIN_SUBSIDY'
  amount_energy integer NOT NULL DEFAULT 50,
  cost_ceiling_krw integer NOT NULL DEFAULT 5000,
  idempotency_key text NOT NULL UNIQUE,
  business_verification_id text,
  granted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_energy_grants_ws
  ON public.energy_grants (workspace_id, granted_at DESC);

ALTER TABLE public.energy_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.energy_grants FROM anon, public;
GRANT ALL ON TABLE public.energy_grants TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'energy_grants' AND policyname = 'energy_grants_tenant_isolation'
  ) THEN
    CREATE POLICY energy_grants_tenant_isolation ON public.energy_grants
      FOR ALL TO authenticated
      USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
        )
      );
  END IF;
END $$;

-- 4. budget_reservations (Run preflight reservation)
CREATE TABLE IF NOT EXISTS public.budget_reservations (
  reservation_id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  estimated_energy integer NOT NULL DEFAULT 10,
  status text NOT NULL DEFAULT 'RESERVED', -- 'RESERVED', 'SETTLED', 'RELEASED'
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_reservations_ws_status
  ON public.budget_reservations (workspace_id, status);

ALTER TABLE public.budget_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.budget_reservations FROM anon, public;
GRANT ALL ON TABLE public.budget_reservations TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'budget_reservations' AND policyname = 'budget_reservations_tenant_isolation'
  ) THEN
    CREATE POLICY budget_reservations_tenant_isolation ON public.budget_reservations
      FOR ALL TO authenticated
      USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
        )
      );
  END IF;
END $$;

-- 5. provider_usage (Raw token/action telemetry)
CREATE TABLE IF NOT EXISTS public.provider_usage (
  usage_id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_id text,
  provider text NOT NULL, -- 'GEMINI', 'OPENAI', 'ANTHROPIC', 'META', 'NAVER'
  model_name text NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  cogs_cost_krw numeric(10, 4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_usage_ws
  ON public.provider_usage (workspace_id, created_at DESC);

ALTER TABLE public.provider_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.provider_usage FROM anon, public;
GRANT ALL ON TABLE public.provider_usage TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'provider_usage' AND policyname = 'provider_usage_tenant_isolation'
  ) THEN
    CREATE POLICY provider_usage_tenant_isolation ON public.provider_usage
      FOR ALL TO authenticated
      USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
        )
      );
  END IF;
END $$;

-- 6. cost_ledger (Attributed COGS ledger)
CREATE TABLE IF NOT EXISTS public.cost_ledger (
  ledger_id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_id text,
  category text NOT NULL, -- 'AI_INFERENCE', 'BROWSER_AUTOMATION', 'STORAGE', 'EXTERNAL_API'
  amount_krw numeric(10, 4) NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_ledger_ws
  ON public.cost_ledger (workspace_id, created_at DESC);

ALTER TABLE public.cost_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cost_ledger FROM anon, public;
GRANT ALL ON TABLE public.cost_ledger TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cost_ledger' AND policyname = 'cost_ledger_tenant_isolation'
  ) THEN
    CREATE POLICY cost_ledger_tenant_isolation ON public.cost_ledger
      FOR ALL TO authenticated
      USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
        )
      );
  END IF;
END $$;
