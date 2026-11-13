-- ==============================================================================
-- Migration: 20260909030000_ani1115_storage_10mb_config_sync.sql
-- Issue: ANI-1115 ([11차/P1] content-media Storage↔DB Reconciliation + 10MB Config Drift 종결)
-- Author: Antigravity Autonomous Agent
-- Target Database: Supabase PostgreSQL (your-project-ref)
-- Description:
--   1. Ensure content-media bucket in storage.buckets has exact 10MB limit (10485760 bytes)
--   2. Enforce private bucket status and allowed MIME types (JPEG, PNG, WebP)
--   3. Confirm media_assets.size_bytes limit check (<= 10485760)
-- ==============================================================================

BEGIN;

-- 1. Sync bucket configuration to exact 10MB limit (10485760 bytes)
UPDATE storage.buckets
SET
  file_size_limit = 10485760,
  public = false,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'content-media';

-- 2. Ensure media_assets constraint enforces 10MB upper bound
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_media_assets_max_size_10mb'
  ) THEN
    ALTER TABLE public.media_assets
      ADD CONSTRAINT chk_media_assets_max_size_10mb
      CHECK (size_bytes <= 10485760);
  END IF;
END $$;

COMMIT;
