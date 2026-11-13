-- Migration: 20260906220000_v09_runtime_control_state.sql
-- Description: Durable runtime control state table eliminating split-brain across server, worker, and admin surfaces (ANI-915)

CREATE TABLE IF NOT EXISTS public.workspace_runtime_control_states (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  desired_mode TEXT NOT NULL DEFAULT 'PAUSED' CHECK (desired_mode IN ('OFF', 'RUNNING', 'PAUSED')),
  actual_mode TEXT NOT NULL DEFAULT 'PAUSED' CHECK (actual_mode IN ('OFF', 'ARMING', 'RUNNING', 'DEGRADED', 'PAUSED', 'BLOCKED')),
  active_plan_id TEXT,
  active_action_run_count INTEGER NOT NULL DEFAULT 0,
  blocker_code TEXT,
  pause_reason TEXT,
  transition_id TEXT NOT NULL DEFAULT ('init-' || substr(md5(random()::text), 1, 8)),
  snapshot_version BIGINT NOT NULL DEFAULT 1,
  version BIGINT NOT NULL DEFAULT 1,
  kill_switch_active BOOLEAN NOT NULL DEFAULT false,
  last_heartbeat_at TIMESTAMPTZ,
  updated_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.workspace_runtime_control_states ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "workspace_runtime_control_states_read_member"
  ON public.workspace_runtime_control_states
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_runtime_control_states.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY "workspace_runtime_control_states_service_role"
  ON public.workspace_runtime_control_states
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Index for heartbeat and active lookups
CREATE INDEX IF NOT EXISTS idx_runtime_control_state_mode
  ON public.workspace_runtime_control_states (actual_mode, last_heartbeat_at);
