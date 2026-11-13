-- ==============================================================================
-- Migration: 20260909020000_ani1114_generated_media_db_invariants.sql
-- Issue: ANI-1114 ([11차/P0] Generated Media Evidence DB Invariant + Publishability Guard)
-- Author: Antigravity Autonomous Agent
-- Target Database: Supabase PostgreSQL (your-project-ref)
-- Description:
--   1. Add CHECK constraint chk_media_assets_generated_openai_evidence:
--      Enforces that any GENERATED_OPENAI row must have:
--        - valid 64-char hex sha256_digest
--        - positive size_bytes
--        - non-empty generation_metadata->>'model'
--        - non-empty object_path
--   2. Add CHECK constraint chk_media_assets_publishable_evidence:
--      Enforces that any row where publish_eligibility = true must have:
--        - lifecycle_status = 'READY'
--        - provenance_kind != 'LEGACY_UNKNOWN' AND provenance_kind != 'QUARANTINED'
--        - valid sha256_digest and positive size_bytes
-- ==============================================================================

BEGIN;

-- 1. Enforce GENERATED_OPENAI proof completeness
ALTER TABLE public.media_assets
  ADD CONSTRAINT chk_media_assets_generated_openai_evidence
  CHECK (
    provenance_kind != 'GENERATED_OPENAI'
    OR (
      sha256_digest IS NOT NULL
      AND sha256_digest ~ '^[a-f0-9]{64}$'
      AND size_bytes > 0
      AND (generation_metadata->>'model' IS NOT NULL AND generation_metadata->>'model' <> '')
      AND object_path IS NOT NULL
      AND object_path <> ''
    )
  );

-- 2. Enforce publishable media asset evidence
ALTER TABLE public.media_assets
  ADD CONSTRAINT chk_media_assets_publishable_evidence
  CHECK (
    publish_eligibility = false
    OR (
      lifecycle_status = 'READY'
      AND provenance_kind != 'LEGACY_UNKNOWN'
      AND provenance_kind != 'QUARANTINED'
      AND sha256_digest IS NOT NULL
      AND sha256_digest ~ '^[a-f0-9]{64}$'
      AND size_bytes > 0
      AND object_path IS NOT NULL
      AND object_path <> ''
    )
  );

COMMIT;
