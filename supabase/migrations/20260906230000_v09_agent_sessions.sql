-- ============================================================================
-- Sohee V0.9 5차 수정: Wave 1 Durable Agent Session Schema Migration
-- Linear Issues: ANI-918, ANI-939
--
-- 1. Create agent_sessions table (SSOT for active workspace agent session)
-- 2. Create agent_approvals table (SSOT for pending human-in-the-loop proposals)
-- 3. Row Level Security policies
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  thread_id UUID REFERENCES public.conversation_threads(id) ON DELETE SET NULL,
  conversation_id TEXT,
  current_surface JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id TEXT,
  snapshot_version INT NOT NULL DEFAULT 1,
  device_channel TEXT NOT NULL DEFAULT 'desktop',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'IDLE', 'AWAITING_APPROVAL', 'PAUSED', 'CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_sessions_workspace_session_key UNIQUE (workspace_id, session_id)
);

CREATE INDEX IF NOT EXISTS agent_sessions_workspace_status_idx 
  ON public.agent_sessions (workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS agent_sessions_thread_idx 
  ON public.agent_sessions (thread_id);

-- 2. Durable Agent Approvals (Human-in-the-loop proposals linked to ActionRun)
CREATE TABLE IF NOT EXISTS public.agent_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  proposal_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  action_run_id UUID REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  proposal_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  target_field TEXT,
  current_value JSONB,
  proposed_value JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
  actor_id UUID,
  rejection_reason TEXT,
  version INT NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT agent_approvals_workspace_proposal_key UNIQUE (workspace_id, proposal_id)
);

CREATE INDEX IF NOT EXISTS agent_approvals_workspace_status_idx
  ON public.agent_approvals (workspace_id, status, created_at DESC);

-- RLS
ALTER TABLE public.agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_sessions_select"
ON public.agent_sessions FOR SELECT
TO authenticated
USING (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "agent_sessions_insert"
ON public.agent_sessions FOR INSERT
TO authenticated
WITH CHECK (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "agent_sessions_update"
ON public.agent_sessions FOR UPDATE
TO authenticated
USING (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
  )
)
WITH CHECK (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "agent_approvals_select"
ON public.agent_approvals FOR SELECT
TO authenticated
USING (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "agent_approvals_insert"
ON public.agent_approvals FOR INSERT
TO authenticated
WITH CHECK (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "agent_approvals_update"
ON public.agent_approvals FOR UPDATE
TO authenticated
USING (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
  )
)
WITH CHECK (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.agent_sessions TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_approvals TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.agent_approvals TO authenticated;
