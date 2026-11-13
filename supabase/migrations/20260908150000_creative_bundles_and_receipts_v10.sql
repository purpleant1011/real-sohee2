-- Migration: 20260908150000_creative_bundles_and_receipts_v10.sql
-- Description: Wave 4 & 5 CreativeBundle & ExternalActionReceipts Persistence (ANI-1080, ANI-1081, ANI-1082, ANI-1083, ANI-1085)

-- ====================================================================
-- 1. Create creative_bundles table
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.creative_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.content_versions(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('instagram', 'threads')),
  caption text NOT NULL,
  hashtags text[] NOT NULL DEFAULT '{}',
  creative_brief_version text NOT NULL DEFAULT 'v10.0',
  bundle_fingerprint text NOT NULL,
  approval_status text NOT NULL DEFAULT 'PENDING' CHECK (approval_status IN ('PENDING', 'APPROVED', 'SUPERSEDED', 'REJECTED')),
  approved_fingerprint text,
  approved_at timestamptz,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creative_bundles_lookup 
  ON public.creative_bundles (workspace_id, content_id, version_id, channel);

CREATE INDEX IF NOT EXISTS idx_creative_bundles_fingerprint 
  ON public.creative_bundles (bundle_fingerprint);

ALTER TABLE public.creative_bundles ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'creative_bundles' AND policyname = 'workspaces_access_creative_bundles') THEN
    CREATE POLICY "workspaces_access_creative_bundles" ON public.creative_bundles
      FOR ALL TO authenticated
      USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'creative_bundles' AND policyname = 'service_role_all_creative_bundles') THEN
    CREATE POLICY "service_role_all_creative_bundles" ON public.creative_bundles
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- ====================================================================
-- 2. Create creative_bundle_media table
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.creative_bundle_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id uuid NOT NULL REFERENCES public.creative_bundles(id) ON DELETE CASCADE,
  media_asset_id uuid NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  role text NOT NULL CHECK (role IN ('primary', 'carousel_item', 'thumbnail')),
  sha256_digest text NOT NULL,
  crop_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT creative_bundle_media_bundle_position_key UNIQUE (bundle_id, position)
);

CREATE INDEX IF NOT EXISTS idx_creative_bundle_media_bundle 
  ON public.creative_bundle_media (bundle_id, position);

ALTER TABLE public.creative_bundle_media ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'creative_bundle_media' AND policyname = 'workspaces_access_creative_bundle_media') THEN
    CREATE POLICY "workspaces_access_creative_bundle_media" ON public.creative_bundle_media
      FOR ALL TO authenticated
      USING (bundle_id IN (SELECT id FROM public.creative_bundles WHERE workspace_id IN (
        SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
      )));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'creative_bundle_media' AND policyname = 'service_role_all_creative_bundle_media') THEN
    CREATE POLICY "service_role_all_creative_bundle_media" ON public.creative_bundle_media
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
