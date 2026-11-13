-- ==============================================================================
-- Sohee Admin V0.2 — V0.8.8 Control Plane Core Migration
-- Date: 2026-09-01
-- Tables: agent_missions, agent_action_runs, external_verification_events,
--         usage_events, provider_pricing_versions, runtime_control_versions
-- RPCs: Control Tower, Agent Runs, FinOps & Revenue Summaries
-- ==============================================================================

-- 1. Agent Missions
CREATE TABLE IF NOT EXISTS public.agent_missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'GROWTH',
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'BLOCKED')),
  goal TEXT,
  risk_tier TEXT NOT NULL DEFAULT 'LOW' CHECK (risk_tier IN ('LOW', 'MEDIUM', 'HIGH', 'IRREVERSIBLE')),
  autonomy_mode TEXT NOT NULL DEFAULT 'GUARDED_AUTO',
  model_route TEXT NOT NULL DEFAULT 'gpt-4o',
  total_reserved_sc BIGINT NOT NULL DEFAULT 0,
  total_settled_sc BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_missions_workspace ON public.agent_missions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_missions_status ON public.agent_missions(status);

-- 2. Agent Action Runs
CREATE TABLE IF NOT EXISTS public.agent_action_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID REFERENCES public.agent_missions(id) ON DELETE SET NULL,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  step_index INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'EXECUTING' CHECK (status IN (
    'QUEUED', 'PREFLIGHT', 'AWAITING_APPROVAL', 'RESERVED',
    'EXECUTING', 'PROVIDER_ACCEPTED', 'VERIFICATION_PENDING',
    'VERIFIED', 'SETTLED', 'COMPLETED', 'BLOCKED',
    'FAILED', 'RESULT_UNKNOWN', 'CANCELED', 'DEAD_LETTER'
  )),
  risk_tier TEXT NOT NULL DEFAULT 'LOW',
  approval_id UUID,
  reserved_sc BIGINT NOT NULL DEFAULT 0,
  settled_sc BIGINT NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT 'OPENAI',
  model TEXT NOT NULL DEFAULT 'gpt-4o',
  tool_name TEXT,
  error_code TEXT,
  provider_accepted_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_action_runs_workspace ON public.agent_action_runs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_action_runs_mission ON public.agent_action_runs(mission_id);
CREATE INDEX IF NOT EXISTS idx_agent_action_runs_status ON public.agent_action_runs(status);

-- 3. External Verification Events (Runtime Truth)
CREATE TABLE IF NOT EXISTS public.external_verification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_run_id UUID REFERENCES public.agent_action_runs(id) ON DELETE SET NULL,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('INSTAGRAM', 'THREADS', 'NAVER_BLOG', 'DANGGEUN', 'NAVER_PLACE', 'KAKAO')),
  verification_method TEXT NOT NULL DEFAULT 'READ_AFTER_WRITE',
  external_id TEXT,
  permalink TEXT,
  result TEXT NOT NULL CHECK (result IN ('VERIFIED', 'PENDING', 'FAILED', 'UNKNOWN')),
  evidence_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ext_verif_action_run ON public.external_verification_events(action_run_id);
CREATE INDEX IF NOT EXISTS idx_ext_verif_workspace ON public.external_verification_events(workspace_id);

-- 4. AI Usage Events & FinOps
CREATE TABLE IF NOT EXISTS public.usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  mission_id UUID REFERENCES public.agent_missions(id) ON DELETE SET NULL,
  action_run_id UUID REFERENCES public.agent_action_runs(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'OPENAI',
  model TEXT NOT NULL,
  operation TEXT NOT NULL DEFAULT 'CHAT_COMPLETION',
  input_tokens BIGINT NOT NULL DEFAULT 0,
  cached_input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  reasoning_tokens BIGINT NOT NULL DEFAULT 0,
  image_units INT NOT NULL DEFAULT 0,
  cost_cents NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
  cost_status TEXT NOT NULL DEFAULT 'PRICED' CHECK (cost_status IN ('PRICED', 'UNPRICED', 'ESTIMATED')),
  pricing_version TEXT NOT NULL DEFAULT '2026-Q3-V1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_workspace ON public.usage_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_created ON public.usage_events(created_at);

-- 5. Provider Pricing Versions
CREATE TABLE IF NOT EXISTS public.provider_pricing_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  operation TEXT NOT NULL,
  input_price_per_million NUMERIC(10, 4) NOT NULL DEFAULT 2.5000,
  cached_input_price_per_million NUMERIC(10, 4) NOT NULL DEFAULT 1.2500,
  output_price_per_million NUMERIC(10, 4) NOT NULL DEFAULT 10.0000,
  image_unit_price NUMERIC(10, 4) NOT NULL DEFAULT 0.0400,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to TIMESTAMPTZ,
  version_tag TEXT NOT NULL DEFAULT '2026-Q3-V1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Runtime Control Versions
CREATE TABLE IF NOT EXISTS public.runtime_control_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  control_type TEXT NOT NULL CHECK (control_type IN ('FEATURE_FLAG', 'MODEL_ROUTE', 'PROMPT', 'POLICY', 'CAPABILITY')),
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  risk_tier TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (risk_tier IN ('LOW', 'MEDIUM', 'HIGH', 'IRREVERSIBLE')),
  scope TEXT NOT NULL DEFAULT 'GLOBAL' CHECK (scope IN ('GLOBAL', 'WORKSPACE', 'PLAN')),
  rollout_percentage INT NOT NULL DEFAULT 100 CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'ROLLED_BACK')),
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_runtime_control_key ON public.runtime_control_versions(key);

-- ==============================================================================
-- RPC Functions for Operator Control Plane
-- ==============================================================================

-- 1. Control Tower Summary RPC
CREATE OR REPLACE FUNCTION public.get_operator_control_tower_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_active_workspaces BIGINT;
  v_running_missions BIGINT;
  v_pending_verifications BIGINT;
  v_total_settled_sc BIGINT;
  v_total_cogs_usd NUMERIC;
BEGIN
  SELECT COUNT(*) INTO v_active_workspaces FROM public.workspaces;
  SELECT COUNT(*) INTO v_running_missions FROM public.agent_missions WHERE status = 'RUNNING';
  SELECT COUNT(*) INTO v_pending_verifications FROM public.agent_action_runs WHERE status = 'VERIFICATION_PENDING';
  SELECT COALESCE(SUM(total_settled_sc), 0) INTO v_total_settled_sc FROM public.agent_missions;
  SELECT COALESCE(SUM(cost_cents) / 100.0, 0.0) INTO v_total_cogs_usd FROM public.usage_events;

  v_result := jsonb_build_object(
    'active_workspaces', v_active_workspaces,
    'running_missions', v_running_missions,
    'pending_verifications', v_pending_verifications,
    'total_settled_sc', v_total_settled_sc,
    'total_cogs_usd', v_total_cogs_usd,
    'risk_rail', jsonb_build_array(
      jsonb_build_object(
        'id', 'risk-1',
        'severity', 'P0',
        'title', '4채널 외부 검증 지연',
        'count', v_pending_verifications,
        'age', '3m',
        'action', 'Reconcile',
        'domain', 'publishing'
      ),
      jsonb_build_object(
        'id', 'risk-2',
        'severity', 'P1',
        'title', '미단가 AI 사용량(Unpriced)',
        'count', 0,
        'age', '0m',
        'action', 'Inspect',
        'domain', 'finops'
      )
    ),
    'generated_at', now()
  );

  RETURN v_result;
END;
$$;

-- 2. Agent Runs List RPC
CREATE OR REPLACE FUNCTION public.get_operator_agent_runs(
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0,
  p_status TEXT DEFAULT NULL,
  p_workspace_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_runs JSONB;
  v_total BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM public.agent_action_runs r
  WHERE (p_status IS NULL OR r.status = p_status)
    AND (p_workspace_id IS NULL OR r.workspace_id = p_workspace_id);

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_runs
  FROM (
    SELECT
      r.id,
      r.mission_id,
      r.workspace_id,
      w.name as workspace_name,
      r.action_type,
      r.step_index,
      r.status,
      r.risk_tier,
      r.provider,
      r.model,
      r.tool_name,
      r.reserved_sc,
      r.settled_sc,
      r.error_code,
      r.provider_accepted_at,
      r.verified_at,
      r.created_at
    FROM public.agent_action_runs r
    LEFT JOIN public.workspaces w ON r.workspace_id = w.id
    WHERE (p_status IS NULL OR r.status = p_status)
      AND (p_workspace_id IS NULL OR r.workspace_id = p_workspace_id)
    ORDER BY r.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) t;

  RETURN jsonb_build_object(
    'total', v_total,
    'items', v_runs
  );
END;
$$;
