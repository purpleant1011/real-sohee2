-- ============================================================================
-- Migration: 20260907020000_v09_finops_dual_ledger.sql
-- Description: Durable FinOps Dual Ledger & Real Settlement (ANI-952, ANI-968, ANI-969)
-- Canonical credit standardization, AI credit ledger & external KRW ad spend segregation,
-- quote -> reserve -> execute -> settle / release lifecycle tables.
-- ============================================================================

-- 1. AI Credit Ledgers (Internal AI credit SSOT: balance, reserved, total_granted)
CREATE TABLE IF NOT EXISTS public.ai_credit_ledgers (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  balance NUMERIC NOT NULL DEFAULT 0,
  reserved NUMERIC NOT NULL DEFAULT 0,
  total_granted NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. External Ad Spend Ledgers (Segregated KRW ad spend: spent_krw, budget_limit_krw)
CREATE TABLE IF NOT EXISTS public.external_ad_spend_ledgers (
  spend_ledger_id TEXT PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ad_account_id TEXT NOT NULL DEFAULT 'default',
  channel TEXT NOT NULL,
  spent_krw NUMERIC NOT NULL DEFAULT 0,
  budget_limit_krw NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT external_ad_spend_ledgers_workspace_channel_account UNIQUE (workspace_id, channel, ad_account_id)
);

-- 3. FinOps Reservations (Pre-flight reservation lifecycle gate)
CREATE TABLE IF NOT EXISTS public.finops_reservations (
  reservation_id TEXT PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  action_run_id TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'SETTLED', 'RELEASED')),
  quote_id TEXT,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. FinOps Settlements (Final actual cost settlement)
CREATE TABLE IF NOT EXISTS public.finops_settlements (
  settlement_id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES public.finops_reservations(reservation_id) ON DELETE CASCADE,
  actual_cost NUMERIC NOT NULL,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_credit_ledgers_updated_at
  ON public.ai_credit_ledgers (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_external_ad_spend_workspace
  ON public.external_ad_spend_ledgers (workspace_id, channel);

CREATE INDEX IF NOT EXISTS idx_finops_reservations_workspace
  ON public.finops_reservations (workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_finops_reservations_action_run
  ON public.finops_reservations (action_run_id);

CREATE INDEX IF NOT EXISTS idx_finops_reservations_idempotency
  ON public.finops_reservations (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_finops_settlements_reservation
  ON public.finops_settlements (reservation_id);

CREATE INDEX IF NOT EXISTS idx_finops_settlements_settled_at
  ON public.finops_settlements (settled_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.ai_credit_ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_ad_spend_ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finops_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finops_settlements ENABLE ROW LEVEL SECURITY;

-- Tenant Isolation Policies for Authenticated Users
DO $$
BEGIN
  -- ai_credit_ledgers policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ai_credit_ledgers' AND policyname = 'ai_credit_ledgers_isolation'
  ) THEN
    CREATE POLICY ai_credit_ledgers_isolation ON public.ai_credit_ledgers
      FOR ALL TO authenticated
      USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
        )
      );
  END IF;

  -- external_ad_spend_ledgers policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'external_ad_spend_ledgers' AND policyname = 'external_ad_spend_ledgers_isolation'
  ) THEN
    CREATE POLICY external_ad_spend_ledgers_isolation ON public.external_ad_spend_ledgers
      FOR ALL TO authenticated
      USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
        )
      );
  END IF;

  -- finops_reservations policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'finops_reservations' AND policyname = 'finops_reservations_isolation'
  ) THEN
    CREATE POLICY finops_reservations_isolation ON public.finops_reservations
      FOR ALL TO authenticated
      USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
        )
      );
  END IF;

  -- finops_settlements policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'finops_settlements' AND policyname = 'finops_settlements_isolation'
  ) THEN
    CREATE POLICY finops_settlements_isolation ON public.finops_settlements
      FOR ALL TO authenticated
      USING (
        reservation_id IN (
          SELECT reservation_id FROM public.finops_reservations r
          WHERE r.workspace_id IN (
            SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
          )
        )
      );
  END IF;
END $$;

-- Service Role Policies (Full access)
CREATE POLICY "ai_credit_ledgers_service_role"
  ON public.ai_credit_ledgers FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "external_ad_spend_ledgers_service_role"
  ON public.external_ad_spend_ledgers FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "finops_reservations_service_role"
  ON public.finops_reservations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "finops_settlements_service_role"
  ON public.finops_settlements FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Permissions
REVOKE ALL ON TABLE public.ai_credit_ledgers, public.external_ad_spend_ledgers, public.finops_reservations, public.finops_settlements FROM anon, public;
GRANT ALL ON TABLE public.ai_credit_ledgers, public.external_ad_spend_ledgers, public.finops_reservations, public.finops_settlements TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ai_credit_ledgers, public.external_ad_spend_ledgers, public.finops_reservations, public.finops_settlements TO authenticated;
