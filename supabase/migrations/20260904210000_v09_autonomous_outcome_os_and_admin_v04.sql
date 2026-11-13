-- ============================================================================
-- Migration: 20260904210000_v09_autonomous_outcome_os_and_admin_v04.sql
-- Issues:
--   [ANI-661] [ANI-686] V0.9 Autonomous Outcome OS & Admin V0.4 Control Tower Schema
--   [ANI-662] workspace_knowledge_harnesses
--   [ANI-665] work_proposals
--   [ANI-666] approval_envelopes
--   [ANI-667] automation_instances
--   [ANI-672] verified_proof_receipts
--   [ANI-673] agent_energy_ledgers & agent_energy_transactions
--   [ANI-693] hierarchical_kill_switches
--   [ANI-696] operator_audit_sessions
-- ============================================================================

-- 1. workspace_knowledge_harnesses
CREATE TABLE IF NOT EXISTS public.workspace_knowledge_harnesses (
  harness_version_id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  version_no integer NOT NULL DEFAULT 1,
  compiled_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  business_identity jsonb NOT NULL DEFAULT '{}'::jsonb,
  offerings jsonb NOT NULL DEFAULT '[]'::jsonb,
  audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  brand_voice jsonb NOT NULL DEFAULT '{}'::jsonb,
  policies jsonb NOT NULL DEFAULT '{}'::jsonb,
  channel_truth jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_harnesses_workspace_active
  ON public.workspace_knowledge_harnesses (workspace_id, is_active);

ALTER TABLE public.workspace_knowledge_harnesses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.workspace_knowledge_harnesses FROM anon, public;
GRANT ALL ON TABLE public.workspace_knowledge_harnesses TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workspace_knowledge_harnesses' AND policyname = 'harnesses_tenant_isolation'
  ) THEN
    CREATE POLICY harnesses_tenant_isolation ON public.workspace_knowledge_harnesses
      FOR ALL TO authenticated
      USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
        )
      );
  END IF;
END $$;

-- 2. approval_envelopes (referenced by work_proposals and automation_instances)
CREATE TABLE IF NOT EXISTS public.approval_envelopes (
  envelope_id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  autonomy_level text NOT NULL DEFAULT 'A3_ENVELOPE_AUTONOMY',
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NOT NULL,
  allowed_channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_posts_per_day integer NOT NULL DEFAULT 2,
  max_discount_percent_allowed integer NOT NULL DEFAULT 10,
  dm_policy text NOT NULL DEFAULT 'AUTONOMOUS',
  max_agent_energy_cap integer NOT NULL DEFAULT 1000,
  risk_ceiling text NOT NULL DEFAULT 'R1_MODERATE',
  prohibited_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  approved_at timestamptz NOT NULL DEFAULT now(),
  approved_by text
);

CREATE INDEX IF NOT EXISTS idx_envelopes_workspace_active
  ON public.approval_envelopes (workspace_id, is_active);

ALTER TABLE public.approval_envelopes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.approval_envelopes FROM anon, public;
GRANT ALL ON TABLE public.approval_envelopes TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'approval_envelopes' AND policyname = 'envelopes_tenant_isolation'
  ) THEN
    CREATE POLICY envelopes_tenant_isolation ON public.approval_envelopes
      FOR ALL TO authenticated
      USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
        )
      );
  END IF;
END $$;

-- 3. work_proposals
CREATE TABLE IF NOT EXISTS public.work_proposals (
  proposal_id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  goal_id text,
  title text NOT NULL,
  rationale text NOT NULL,
  evidence_context jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_outcome jsonb NOT NULL DEFAULT '{}'::jsonb,
  execution_plan_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  estimated_agent_energy integer NOT NULL DEFAULT 100,
  proposed_envelope jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PROPOSED',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_proposals_workspace_status
  ON public.work_proposals (workspace_id, status);

ALTER TABLE public.work_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.work_proposals FROM anon, public;
GRANT ALL ON TABLE public.work_proposals TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'work_proposals' AND policyname = 'proposals_tenant_isolation'
  ) THEN
    CREATE POLICY proposals_tenant_isolation ON public.work_proposals
      FOR ALL TO authenticated
      USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
        )
      );
  END IF;
END $$;

-- 4. agent_energy_ledgers
CREATE TABLE IF NOT EXISTS public.agent_energy_ledgers (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_tier text NOT NULL DEFAULT 'TIER_300K_GROWTH',
  monthly_total_energy integer NOT NULL DEFAULT 3000,
  used_energy_current_month integer NOT NULL DEFAULT 0,
  reserved_energy_active_runs integer NOT NULL DEFAULT 0,
  remaining_available_energy integer NOT NULL DEFAULT 3000,
  burn_rate_percentage integer NOT NULL DEFAULT 0,
  budget_alert_stage text NOT NULL DEFAULT 'NORMAL',
  forecast_run_out_days integer NOT NULL DEFAULT 30,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_energy_ledgers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_energy_ledgers FROM anon, public;
GRANT ALL ON TABLE public.agent_energy_ledgers TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'agent_energy_ledgers' AND policyname = 'energy_ledgers_tenant_isolation'
  ) THEN
    CREATE POLICY energy_ledgers_tenant_isolation ON public.agent_energy_ledgers
      FOR ALL TO authenticated
      USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
        )
      );
  END IF;
END $$;

-- 5. agent_energy_transactions
CREATE TABLE IF NOT EXISTS public.agent_energy_transactions (
  transaction_id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  pack_count integer NOT NULL DEFAULT 1,
  paid_amount_krw integer NOT NULL DEFAULT 100000,
  added_energy integer NOT NULL DEFAULT 1000,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_energy_tx_workspace
  ON public.agent_energy_transactions (workspace_id, created_at DESC);

ALTER TABLE public.agent_energy_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_energy_transactions FROM anon, public;
GRANT ALL ON TABLE public.agent_energy_transactions TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'agent_energy_transactions' AND policyname = 'energy_tx_tenant_isolation'
  ) THEN
    CREATE POLICY energy_tx_tenant_isolation ON public.agent_energy_transactions
      FOR ALL TO authenticated
      USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
        )
      );
  END IF;
END $$;

-- 6. automation_instances
CREATE TABLE IF NOT EXISTS public.automation_instances (
  instance_id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  automation_id text NOT NULL,
  version_no integer NOT NULL DEFAULT 1,
  current_state text NOT NULL DEFAULT 'DRAFT',
  state_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  active_envelope_id text REFERENCES public.approval_envelopes(envelope_id) ON DELETE SET NULL,
  scheduled_at timestamptz,
  last_run_at timestamptz,
  next_run_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automations_next_run
  ON public.automation_instances (workspace_id, current_state, next_run_at);

ALTER TABLE public.automation_instances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.automation_instances FROM anon, public;
GRANT ALL ON TABLE public.automation_instances TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'automation_instances' AND policyname = 'automations_tenant_isolation'
  ) THEN
    CREATE POLICY automations_tenant_isolation ON public.automation_instances
      FOR ALL TO authenticated
      USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
        )
      );
  END IF;
END $$;

-- 7. verified_proof_receipts
CREATE TABLE IF NOT EXISTS public.verified_proof_receipts (
  proof_receipt_id text PRIMARY KEY,
  execution_run_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  target_channel text NOT NULL,
  external_post_id text NOT NULL,
  read_back_permalink text NOT NULL,
  read_back_text_hash text NOT NULL,
  read_back_timestamp timestamptz NOT NULL,
  receipt_checksum_sha256 text NOT NULL,
  verification_status text NOT NULL DEFAULT 'VERIFIED',
  verified_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipts_workspace_verified
  ON public.verified_proof_receipts (workspace_id, verified_at DESC);

ALTER TABLE public.verified_proof_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.verified_proof_receipts FROM anon, public;
GRANT ALL ON TABLE public.verified_proof_receipts TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'verified_proof_receipts' AND policyname = 'receipts_tenant_isolation'
  ) THEN
    CREATE POLICY receipts_tenant_isolation ON public.verified_proof_receipts
      FOR ALL TO authenticated
      USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
        )
      );
  END IF;
END $$;

-- 8. hierarchical_kill_switches
CREATE TABLE IF NOT EXISTS public.hierarchical_kill_switches (
  id text PRIMARY KEY,
  level text NOT NULL, -- 'GLOBAL', 'PROVIDER_MCP', 'WORKSPACE', 'AUTOMATION', 'CHANNEL'
  target_identifier text NOT NULL,
  is_engaged boolean NOT NULL DEFAULT false,
  engaged_reason text,
  engaged_by_admin_id text,
  engaged_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_kill_switches_level_target
  ON public.hierarchical_kill_switches (level, target_identifier, is_engaged);

ALTER TABLE public.hierarchical_kill_switches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hierarchical_kill_switches FROM anon, public;
GRANT ALL ON TABLE public.hierarchical_kill_switches TO service_role;

-- Authenticated users can read kill switches to respect stop signals
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hierarchical_kill_switches' AND policyname = 'kill_switches_read_authenticated'
  ) THEN
    CREATE POLICY kill_switches_read_authenticated ON public.hierarchical_kill_switches
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;

-- 9. operator_audit_sessions
CREATE TABLE IF NOT EXISTS public.operator_audit_sessions (
  session_id text PRIMARY KEY,
  operator_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  reason text NOT NULL,
  active_browser_sessions jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider_tokens_revoked jsonb NOT NULL DEFAULT '[]'::jsonb,
  audit_receipt_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_operator_audit_workspace
  ON public.operator_audit_sessions (workspace_id, opened_at DESC);

ALTER TABLE public.operator_audit_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.operator_audit_sessions FROM anon, public;
GRANT ALL ON TABLE public.operator_audit_sessions TO service_role;
