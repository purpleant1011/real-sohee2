-- Migration: 20260908120000_creative_media_asset_truth_v10.sql
-- Description: Wave 1 Canonical MediaAsset SSOT & Creative Pipeline Schema (ANI-1071, ANI-1072, ANI-1073, ANI-1064)
-- Enforces:
--   1. media_assets provenance taxonomy, dimensions, lifecycle, and publish eligibility.
--   2. content_version_media role assignment and unique (version_id, position) invariant.
--   3. publish_renditions channel derivative SSOT with exact rendition_sha256.
--   4. provider_delivery_leases ephemeral signed URL lease tracking.
--   5. Private content-media Storage bucket security.

-- ====================================================================
-- 1. Extend media_assets table
-- ====================================================================
ALTER TABLE public.media_assets 
  ADD COLUMN IF NOT EXISTS provenance_kind text NOT NULL DEFAULT 'GENERATED_OPENAI',
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer,
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'READY',
  ADD COLUMN IF NOT EXISTS publish_eligibility boolean NOT NULL DEFAULT true;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_assets_provenance_kind_check') THEN
    ALTER TABLE public.media_assets 
      ADD CONSTRAINT media_assets_provenance_kind_check 
      CHECK (provenance_kind IN ('GENERATED_OPENAI', 'USER_UPLOAD', 'OWNED_LIBRARY', 'LEGACY_STATIC', 'LEGACY_STOCK', 'LEGACY_UNKNOWN'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_assets_lifecycle_status_check') THEN
    ALTER TABLE public.media_assets 
      ADD CONSTRAINT media_assets_lifecycle_status_check 
      CHECK (lifecycle_status IN ('READY', 'ACTIVE', 'SUPERSEDED', 'QUARANTINED', 'FAILED', 'DELETED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_media_assets_workspace ON public.media_assets(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_assets_sha256 ON public.media_assets(sha256_digest);

-- ====================================================================
-- 2. Extend content_version_media table
-- ====================================================================
ALTER TABLE public.content_version_media 
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'primary';

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_version_media_role_check') THEN
    ALTER TABLE public.content_version_media 
      ADD CONSTRAINT content_version_media_role_check 
      CHECK (role IN ('primary', 'carousel_item', 'thumbnail'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_version_media_version_position_key') THEN
    ALTER TABLE public.content_version_media 
      ADD CONSTRAINT content_version_media_version_position_key 
      UNIQUE (version_id, position);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_content_version_media_lookup 
  ON public.content_version_media(version_id, position);

-- ====================================================================
-- 3. Create publish_renditions table
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.publish_renditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_media_asset_id uuid NOT NULL REFERENCES public.media_assets(id) ON DELETE RESTRICT,
  channel text NOT NULL,
  transform_policy_version text NOT NULL,
  crop_data jsonb,
  format text NOT NULL,
  quality integer,
  width integer NOT NULL,
  height integer NOT NULL,
  aspect_ratio text NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'content-media',
  object_path text NOT NULL,
  rendition_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.publish_renditions ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'publish_renditions' AND policyname = 'workspaces_access_publish_renditions') THEN
    CREATE POLICY "workspaces_access_publish_renditions" ON public.publish_renditions
      FOR ALL TO authenticated
      USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'publish_renditions' AND policyname = 'service_role_all_publish_renditions') THEN
    CREATE POLICY "service_role_all_publish_renditions" ON public.publish_renditions
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_publish_renditions_lookup 
  ON public.publish_renditions(workspace_id, source_media_asset_id, channel);

-- ====================================================================
-- 4. Create provider_delivery_leases table
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.provider_delivery_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rendition_id uuid NOT NULL REFERENCES public.publish_renditions(id) ON DELETE CASCADE,
  provider text NOT NULL,
  purpose text NOT NULL,
  delivery_url text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CONSUMED', 'EXPIRED', 'REVOKED'))
);

ALTER TABLE public.provider_delivery_leases ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'provider_delivery_leases' AND policyname = 'workspaces_access_provider_delivery_leases') THEN
    CREATE POLICY "workspaces_access_provider_delivery_leases" ON public.provider_delivery_leases
      FOR ALL TO authenticated
      USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'provider_delivery_leases' AND policyname = 'service_role_all_provider_delivery_leases') THEN
    CREATE POLICY "service_role_all_provider_delivery_leases" ON public.provider_delivery_leases
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_provider_delivery_leases_active 
  ON public.provider_delivery_leases(rendition_id, status, expires_at);

-- ====================================================================
-- 5. Private Storage Bucket Setup: content-media
-- ====================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('content-media', 'content-media', false, 52428800, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false;
