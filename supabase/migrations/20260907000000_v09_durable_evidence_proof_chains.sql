-- ============================================================================
-- Sohee V0.9 6th Revision: Durable Evidence Proof Chains & Cryptographic Integrity
-- Linear Issues: ANI-967, ANI-968, ANI-969
--
-- 1. Create proof_chains table (SSOT for evidence proof chains and hash blocks)
-- 2. Indexes for fast lookup by workspace_id and idempotency_key
-- 3. Row Level Security policies
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.proof_chains (
  evidence_id TEXT PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  stage TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  response_digest TEXT,
  readback_digest TEXT,
  provider_object_id TEXT,
  provider_url TEXT,
  verifier_version TEXT NOT NULL,
  timestamps JSONB NOT NULL DEFAULT '{}'::jsonb,
  reconcile_status TEXT NOT NULL DEFAULT 'NONE',
  mismatch_detail TEXT,
  raw_evidence_payload JSONB,
  blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  genesis_hash TEXT,
  latest_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT proof_chains_workspace_idempotency_key UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS proof_chains_workspace_id_idx 
  ON public.proof_chains (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS proof_chains_idempotency_key_idx 
  ON public.proof_chains (idempotency_key);

-- RLS
ALTER TABLE public.proof_chains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "proof_chains_select"
ON public.proof_chains FOR SELECT
TO authenticated
USING (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "proof_chains_insert"
ON public.proof_chains FOR INSERT
TO authenticated
WITH CHECK (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "proof_chains_update"
ON public.proof_chains FOR UPDATE
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proof_chains TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.proof_chains TO authenticated;
