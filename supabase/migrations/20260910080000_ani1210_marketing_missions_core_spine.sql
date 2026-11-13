-- ==============================================================================
-- Migration: 20260910080000_ani1210_marketing_missions_core_spine.sql
-- Description: Core schema for Marketing Missions OS & Append-only Mission Events
-- Traceability: ANI-1192, ANI-1210, ANI-1211, ANI-1212
-- ==============================================================================

-- 1. Create marketing_missions table
CREATE TABLE IF NOT EXISTS public.marketing_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  trace_id text NOT NULL,
  status text NOT NULL DEFAULT 'RECEIVED',
  goal text NOT NULL,
  strategy_summary text,
  target_channel text,
  target_audience text,
  source_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  source_conversation_job_id uuid REFERENCES public.conversation_jobs(id) ON DELETE SET NULL,
  content_id uuid REFERENCES public.content_items(id) ON DELETE SET NULL,
  content_version_id uuid REFERENCES public.content_versions(id) ON DELETE SET NULL,
  approval_id uuid REFERENCES public.approvals(id) ON DELETE SET NULL,
  external_action_request_id uuid,
  external_action_attempt_id uuid,
  external_action_receipt_id uuid,
  customer_id uuid,
  booking_id uuid,
  outcome_id uuid,
  next_action_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT chk_marketing_missions_status CHECK (
    status IN (
      'RECEIVED',
      'PLANNING',
      'PRODUCING',
      'AWAITING_APPROVAL',
      'APPROVED',
      'EXECUTING',
      'PUBLISHED_VERIFIED',
      'LISTENING',
      'CUSTOMER_ENGAGED',
      'BOOKING_INTENT',
      'BOOKED',
      'OUTCOME_OBSERVED',
      'LEARNING',
      'NEXT_ACTION_READY',
      'COMPLETED',
      'BLOCKED',
      'FAILED',
      'PAUSED',
      'CANCELLED'
    )
  )
);

-- 2. Create mission_events append-only audit table
CREATE TABLE IF NOT EXISTS public.mission_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  mission_id uuid NOT NULL REFERENCES public.marketing_missions(id) ON DELETE CASCADE,
  trace_id text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_type text NOT NULL,
  actor_id text,
  event_name text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT chk_mission_events_actor_type CHECK (
    actor_type IN ('user', 'agent', 'system', 'provider', 'operator')
  )
);

-- 3. Advisor Optimization: Explicit indexes for foreign keys & queries
CREATE INDEX IF NOT EXISTS idx_marketing_missions_workspace_id ON public.marketing_missions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_marketing_missions_trace_id ON public.marketing_missions(trace_id);
CREATE INDEX IF NOT EXISTS idx_marketing_missions_status ON public.marketing_missions(status);
CREATE INDEX IF NOT EXISTS idx_marketing_missions_created_at ON public.marketing_missions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_missions_source_msg ON public.marketing_missions(source_message_id);
CREATE INDEX IF NOT EXISTS idx_marketing_missions_source_job ON public.marketing_missions(source_conversation_job_id);
CREATE INDEX IF NOT EXISTS idx_marketing_missions_content_id ON public.marketing_missions(content_id);
CREATE INDEX IF NOT EXISTS idx_marketing_missions_approval_id ON public.marketing_missions(approval_id);

CREATE INDEX IF NOT EXISTS idx_mission_events_workspace_id ON public.mission_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_mission_events_mission_id ON public.mission_events(mission_id);
CREATE INDEX IF NOT EXISTS idx_mission_events_trace_id ON public.mission_events(trace_id);
CREATE INDEX IF NOT EXISTS idx_mission_events_occurred_at ON public.mission_events(occurred_at DESC);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.marketing_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mission_events ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for authenticated users (Membership-based read)
DROP POLICY IF EXISTS "marketing_missions_select_policy" ON public.marketing_missions;
CREATE POLICY "marketing_missions_select_policy"
  ON public.marketing_missions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = marketing_missions.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.status = 'active'
    )
    OR
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = marketing_missions.workspace_id
        AND w.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "mission_events_select_policy" ON public.mission_events;
CREATE POLICY "mission_events_select_policy"
  ON public.mission_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = mission_events.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.status = 'active'
    )
    OR
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = mission_events.workspace_id
        AND w.created_by = auth.uid()
    )
  );

-- Service role full access
DROP POLICY IF EXISTS "marketing_missions_service_role_policy" ON public.marketing_missions;
CREATE POLICY "marketing_missions_service_role_policy"
  ON public.marketing_missions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "mission_events_service_role_policy" ON public.mission_events;
CREATE POLICY "mission_events_service_role_policy"
  ON public.mission_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
