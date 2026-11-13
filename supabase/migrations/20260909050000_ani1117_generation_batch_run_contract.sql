-- Migration: 20260909050000_ani1117_generation_batch_run_contract.sql
-- Description: [11차/P0] GenerationBatch / GenerationRun Canonical Contract + Atomic Sequence Guard (ANI-1117)
-- Preserves generation_batches (125 historical rows) and introduces generation_runs with atomic sequence superseding

-- ====================================================================
-- 1. Evolve generation_batches for Logical Batch SSOT (Backward Compatible)
-- ====================================================================

-- Make artifact_id nullable so logical batches can be created directly for content versions
ALTER TABLE public.generation_batches 
  ALTER COLUMN artifact_id DROP NOT NULL;

-- Add content_version_id if not present
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'generation_batches' AND column_name = 'content_version_id'
  ) THEN
    ALTER TABLE public.generation_batches 
      ADD COLUMN content_version_id uuid REFERENCES public.content_versions(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_generation_batches_content_version 
  ON public.generation_batches (content_version_id);

-- ====================================================================
-- 2. Create generation_runs Table (Provider Attempts & Variant Unit)
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.generation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES public.generation_batches(id) ON DELETE CASCADE,
  content_version_id uuid REFERENCES public.content_versions(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  sequence_number integer NOT NULL DEFAULT 1 CHECK (sequence_number >= 1),
  status text NOT NULL DEFAULT 'QUEUED' CHECK (
    status IN (
      'QUEUED',
      'GENERATING',
      'GENERATED_BYTES',
      'STORAGE_COMMIT',
      'QC_PENDING',
      'READY',
      'FAILED',
      'CANCELED',
      'SUPERSEDED',
      'STALE_RESULT'
    )
  ),
  prompt_digest text NOT NULL,
  media_asset_id uuid REFERENCES public.media_assets(id) ON DELETE SET NULL,
  storage_path text,
  sha256_digest text,
  byte_length integer,
  error_code text,
  error_message text,
  usage jsonb,
  is_current boolean NOT NULL DEFAULT false,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_generation_runs_workspace_idempotency UNIQUE (workspace_id, idempotency_key)
);

-- Partial index: at most one current active run per content version
CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_runs_current 
  ON public.generation_runs (content_version_id) 
  WHERE (is_current = true);

-- Performance indexes for lookup and sequence traversal
CREATE INDEX IF NOT EXISTS idx_generation_runs_version_seq 
  ON public.generation_runs (content_version_id, sequence_number DESC);

CREATE INDEX IF NOT EXISTS idx_generation_runs_batch 
  ON public.generation_runs (batch_id);

CREATE INDEX IF NOT EXISTS idx_generation_runs_media_asset 
  ON public.generation_runs (media_asset_id);

-- ====================================================================
-- 3. DB Invariants (Check Constraints)
-- ====================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_generation_runs_no_stale_ready'
  ) THEN
    ALTER TABLE public.generation_runs
      ADD CONSTRAINT chk_generation_runs_no_stale_ready
      CHECK (NOT (status = 'READY' AND superseded_at IS NOT NULL));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_generation_runs_stale_not_current'
  ) THEN
    ALTER TABLE public.generation_runs
      ADD CONSTRAINT chk_generation_runs_stale_not_current
      CHECK (NOT (status IN ('SUPERSEDED', 'STALE_RESULT', 'FAILED', 'CANCELED') AND is_current = true));
  END IF;
END $$;

-- ====================================================================
-- 4. DB Atomic Predicate / Sequence Supersede Trigger
-- ====================================================================
CREATE OR REPLACE FUNCTION public.fn_generation_runs_atomic_sequence_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- A. On INSERT: atomically supersede in-flight lower sequence runs for same version
  IF TG_OP = 'INSERT' THEN
    IF NEW.content_version_id IS NOT NULL THEN
      UPDATE public.generation_runs
      SET 
        status = 'SUPERSEDED',
        superseded_at = COALESCE(superseded_at, now()),
        is_current = false,
        updated_at = now()
      WHERE content_version_id = NEW.content_version_id
        AND sequence_number < NEW.sequence_number
        AND status IN ('QUEUED', 'GENERATING', 'GENERATED_BYTES', 'STORAGE_COMMIT', 'QC_PENDING')
        AND id != NEW.id;
    END IF;
  END IF;

  -- B. On UPDATE attempting to set status = 'READY':
  IF TG_OP = 'UPDATE' AND NEW.status = 'READY' THEN
    -- B1. If run was already superseded or marked superseded_at, demote to STALE_RESULT
    IF OLD.status = 'SUPERSEDED' OR OLD.superseded_at IS NOT NULL THEN
      NEW.status := 'STALE_RESULT';
      NEW.is_current := false;
      NEW.superseded_at := COALESCE(OLD.superseded_at, now());
    END IF;

    -- B2. If a HIGHER sequence number already exists for this version, demote to STALE_RESULT
    IF NEW.content_version_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.generation_runs
      WHERE content_version_id = NEW.content_version_id
        AND sequence_number > NEW.sequence_number
        AND id != NEW.id
    ) THEN
      NEW.status := 'STALE_RESULT';
      NEW.is_current := false;
      NEW.superseded_at := COALESCE(NEW.superseded_at, now());
    END IF;

    -- B3. If status remains READY, set is_current = true and unmark other current runs for version
    IF NEW.status = 'READY' THEN
      NEW.is_current := true;
      IF NEW.content_version_id IS NOT NULL THEN
        UPDATE public.generation_runs
        SET is_current = false, updated_at = now()
        WHERE content_version_id = NEW.content_version_id
          AND id != NEW.id
          AND is_current = true;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generation_runs_atomic_sequence_guard ON public.generation_runs;
CREATE TRIGGER trg_generation_runs_atomic_sequence_guard
  BEFORE INSERT OR UPDATE ON public.generation_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_generation_runs_atomic_sequence_guard();

-- Explicitly revoke EXECUTE from public/anon/authenticated on internal trigger function
REVOKE ALL ON FUNCTION public.fn_generation_runs_atomic_sequence_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_generation_runs_atomic_sequence_guard() TO service_role;

-- ====================================================================
-- 5. Row Level Security (RLS) & Role Grants (Least Privilege)
-- ====================================================================
ALTER TABLE public.generation_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.generation_runs FROM anon;
REVOKE ALL ON public.generation_runs FROM authenticated;

GRANT SELECT ON public.generation_runs TO authenticated;
GRANT ALL ON public.generation_runs TO service_role;

DROP POLICY IF EXISTS "workspaces_select_generation_runs" ON public.generation_runs;
CREATE POLICY "workspaces_select_generation_runs" ON public.generation_runs
  FOR SELECT TO authenticated
  USING (workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "service_role_all_generation_runs" ON public.generation_runs;
CREATE POLICY "service_role_all_generation_runs" ON public.generation_runs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
