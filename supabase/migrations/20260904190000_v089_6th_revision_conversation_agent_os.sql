-- ============================================================================
-- Sohee V0.8.9 6차 수정: Conversation Agent OS Database Schema Migration
-- Linear Issues: ANI-647, ANI-653, ANI-654
-- 
-- 1. Additive-first expansion for existing conversation_threads & messages
-- 2. New agent_runs & agent_run_steps tables for durable execution tracking
-- 3. New agent_memories table for episodic/semantic/procedural long-term memory
-- 4. Strict Supabase RLS policies (TO authenticated + (SELECT auth.uid()) ownership)
-- ============================================================================

-- 1. Expand conversation_threads (Additive)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'conversation_threads' AND column_name = 'model_profile'
  ) THEN
    ALTER TABLE public.conversation_threads 
      ADD COLUMN model_profile TEXT NOT NULL DEFAULT 'conversation_gpt_5_6_luna_max',
      ADD COLUMN last_run_id UUID,
      ADD COLUMN archive_reason TEXT;
  END IF;
END $$;

-- 2. Expand messages (Additive)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'content_parts'
  ) THEN
    ALTER TABLE public.messages 
      ADD COLUMN content_parts JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN tool_calls JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN run_id UUID,
      ADD COLUMN evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- 3. Create agent_runs (Durable Agent Execution Ledger)
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES public.conversation_threads(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (
    status IN ('planning', 'executing', 'verifying', 'completed', 'partially_completed', 'failed', 'cancelled')
  ),
  goal TEXT NOT NULL,
  plan_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace_id TEXT NOT NULL,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS agent_runs_workspace_thread_idx 
  ON public.agent_runs (workspace_id, thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_runs_status_idx 
  ON public.agent_runs (status);

-- RLS for agent_runs
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_runs_select"
ON public.agent_runs FOR SELECT
TO authenticated
USING (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "agent_runs_insert"
ON public.agent_runs FOR INSERT
TO authenticated
WITH CHECK (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "agent_runs_update"
ON public.agent_runs FOR UPDATE
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

-- 4. Create agent_run_steps (DAG Step Ledger)
CREATE TABLE IF NOT EXISTS public.agent_run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  capability_id TEXT NOT NULL,
  risk_tier TEXT NOT NULL DEFAULT 'LOW' CHECK (
    risk_tier IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
  ),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'running', 'verifying', 'completed', 'failed', 'skipped')
  ),
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT,
  external_receipt_id UUID,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT uq_run_step_index UNIQUE (run_id, step_index)
);

CREATE INDEX IF NOT EXISTS agent_run_steps_run_idx 
  ON public.agent_run_steps (run_id, step_index ASC);

-- RLS for agent_run_steps (via parent agent_runs)
ALTER TABLE public.agent_run_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_run_steps_select"
ON public.agent_run_steps FOR SELECT
TO authenticated
USING (
  run_id IN (
    SELECT id FROM public.agent_runs WHERE workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
    )
  )
);

CREATE POLICY "agent_run_steps_insert"
ON public.agent_run_steps FOR INSERT
TO authenticated
WITH CHECK (
  run_id IN (
    SELECT id FROM public.agent_runs WHERE workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
    )
  )
);

CREATE POLICY "agent_run_steps_update"
ON public.agent_run_steps FOR UPDATE
TO authenticated
USING (
  run_id IN (
    SELECT id FROM public.agent_runs WHERE workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
    )
  )
)
WITH CHECK (
  run_id IN (
    SELECT id FROM public.agent_runs WHERE workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
    )
  )
);

-- 5. Create agent_memories (ANI-654 Long-term Memory: Episodic, Semantic, Procedural)
CREATE TABLE IF NOT EXISTS public.agent_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  memory_class TEXT NOT NULL CHECK (memory_class IN ('episodic', 'semantic', 'procedural')),
  subject TEXT NOT NULL,
  fact_content TEXT NOT NULL,
  confidence_score NUMERIC(4,3) NOT NULL DEFAULT 1.000,
  provenance_type TEXT NOT NULL DEFAULT 'manual',
  provenance_id TEXT,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (
    status IN ('observed', 'candidate', 'conflicted', 'approved', 'canonical', 'superseded')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_memories_lookup_idx 
  ON public.agent_memories (workspace_id, memory_class, status);

CREATE INDEX IF NOT EXISTS agent_memories_subject_idx 
  ON public.agent_memories (workspace_id, subject);

-- RLS for agent_memories
ALTER TABLE public.agent_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_memories_select"
ON public.agent_memories FOR SELECT
TO authenticated
USING (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "agent_memories_insert"
ON public.agent_memories FOR INSERT
TO authenticated
WITH CHECK (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "agent_memories_update"
ON public.agent_memories FOR UPDATE
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

-- 6. Grants to authenticated & service_role
GRANT SELECT, INSERT, UPDATE ON public.agent_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.agent_run_steps TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.agent_memories TO authenticated;

GRANT ALL ON public.agent_runs TO service_role;
GRANT ALL ON public.agent_run_steps TO service_role;
GRANT ALL ON public.agent_memories TO service_role;
