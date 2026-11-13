-- ==============================================================================
-- Migration: 20260909010000_ani1113_media_assets_provenance_quarantine.sql
-- Issue: ANI-1113 ([11차/P0] 202 MediaAsset 거짓 GENERATED_OPENAI provenance Quarantine 복구)
-- Author: Antigravity Autonomous Agent
-- Target Database: Supabase PostgreSQL (your-project-ref)
-- Description:
--   1. Create media_asset_quarantine_backup for historical rollback & audit lineage
--   2. Backup all existing 202 media_assets rows before alteration
--   3. Reclassify media assets lacking model metadata or sha256 digest:
--      - provenance_kind = 'LEGACY_UNKNOWN'
--      - lifecycle_status = 'QUARANTINED'
--      - publish_eligibility = false
--   4. Alter media_assets column defaults to prevent false-green defaults on future inserts:
--      - provenance_kind DEFAULT 'LEGACY_UNKNOWN'
--      - publish_eligibility DEFAULT false
--      - lifecycle_status DEFAULT 'PENDING_VALIDATION'
-- ==============================================================================

BEGIN;

-- 1. Create backup audit table
CREATE TABLE IF NOT EXISTS public.media_asset_quarantine_backup (
  backup_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  bucket_id text NOT NULL,
  object_path text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  rights_status text NOT NULL,
  generation_metadata jsonb NOT NULL,
  sha256_digest text,
  original_provenance_kind text NOT NULL,
  original_lifecycle_status text NOT NULL,
  original_publish_eligibility boolean NOT NULL,
  quarantine_reason text NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Populate backup table with rows that are about to be quarantined
INSERT INTO public.media_asset_quarantine_backup (
  asset_id,
  workspace_id,
  bucket_id,
  object_path,
  mime_type,
  size_bytes,
  rights_status,
  generation_metadata,
  sha256_digest,
  original_provenance_kind,
  original_lifecycle_status,
  original_publish_eligibility,
  quarantine_reason
)
SELECT
  id,
  workspace_id,
  bucket_id,
  object_path,
  mime_type,
  size_bytes,
  rights_status,
  generation_metadata,
  sha256_digest,
  provenance_kind,
  lifecycle_status,
  publish_eligibility,
  CASE
    WHEN (generation_metadata->>'model' IS NULL OR generation_metadata->>'model' = '') AND sha256_digest IS NULL
      THEN 'MISSING_MODEL_AND_SHA256'
    WHEN (generation_metadata->>'model' IS NULL OR generation_metadata->>'model' = '')
      THEN 'MISSING_MODEL_METADATA'
    WHEN sha256_digest IS NULL
      THEN 'MISSING_SHA256_DIGEST'
    ELSE 'UNKNOWN_DEFECT'
  END AS quarantine_reason
FROM public.media_assets
WHERE provenance_kind = 'GENERATED_OPENAI'
  AND (
    generation_metadata->>'model' IS NULL
    OR generation_metadata->>'model' = ''
    OR sha256_digest IS NULL
    OR sha256_digest = ''
  );

-- 3. Execute quarantine update on defective media assets
UPDATE public.media_assets
SET
  provenance_kind = 'LEGACY_UNKNOWN',
  lifecycle_status = 'QUARANTINED',
  publish_eligibility = false
WHERE provenance_kind = 'GENERATED_OPENAI'
  AND (
    generation_metadata->>'model' IS NULL
    OR generation_metadata->>'model' = ''
    OR sha256_digest IS NULL
    OR sha256_digest = ''
  );

-- 4. Reset column defaults so future rows do not default to GENERATED_OPENAI / READY / publishable
ALTER TABLE public.media_assets ALTER COLUMN provenance_kind SET DEFAULT 'LEGACY_UNKNOWN';
ALTER TABLE public.media_assets ALTER COLUMN publish_eligibility SET DEFAULT false;
ALTER TABLE public.media_assets ALTER COLUMN lifecycle_status SET DEFAULT 'PENDING_VALIDATION';

-- 5. Enable RLS on backup table
ALTER TABLE public.media_asset_quarantine_backup ENABLE ROW LEVEL SECURITY;

COMMIT;
