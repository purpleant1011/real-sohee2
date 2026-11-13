-- Migration: 20260909040000_ani1116_creative_tables_server_only_mutation.sql
-- Description: [11차/P0] Creative Asset 핵심 테이블 Server-Only Mutation + RLS/GRANT 최소권한 (ANI-1116)
-- Target tables: creative_bundles, creative_bundle_media, publish_renditions, provider_delivery_leases, verified_proof_receipts

-- ====================================================================
-- 1. Pre-Migration Grants & Policies Snapshot Table (Rollback & Audit Safety)
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.creative_permissions_pre_ani1116_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  snapshot_type text NOT NULL,
  target_table text NOT NULL,
  entity_name text NOT NULL,
  definition jsonb NOT NULL
);

ALTER TABLE public.creative_permissions_pre_ani1116_snapshot ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'creative_permissions_pre_ani1116_snapshot' 
      AND policyname = 'service_role_all_snapshot'
  ) THEN
    CREATE POLICY "service_role_all_snapshot" ON public.creative_permissions_pre_ani1116_snapshot
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON public.creative_permissions_pre_ani1116_snapshot FROM anon, authenticated;
GRANT ALL ON public.creative_permissions_pre_ani1116_snapshot TO service_role;

-- Capture pre-migration policies snapshot
INSERT INTO public.creative_permissions_pre_ani1116_snapshot (snapshot_type, target_table, entity_name, definition)
SELECT 
  'POLICY' AS snapshot_type,
  tablename AS target_table,
  policyname AS entity_name,
  to_jsonb(p) AS definition
FROM pg_policies p
WHERE tablename IN ('creative_bundles', 'creative_bundle_media', 'publish_renditions', 'provider_delivery_leases', 'verified_proof_receipts')
ON CONFLICT DO NOTHING;

-- Capture pre-migration table privileges snapshot
INSERT INTO public.creative_permissions_pre_ani1116_snapshot (snapshot_type, target_table, entity_name, definition)
SELECT 
  'PRIVILEGE' AS snapshot_type,
  table_name AS target_table,
  grantee || ':' || privilege_type AS entity_name,
  jsonb_build_object(
    'table_name', table_name,
    'grantee', grantee,
    'privilege_type', privilege_type,
    'is_grantable', is_grantable
  ) AS definition
FROM information_schema.table_privileges
WHERE table_name IN ('creative_bundles', 'creative_bundle_media', 'publish_renditions', 'provider_delivery_leases', 'verified_proof_receipts')
  AND grantee IN ('anon', 'authenticated', 'service_role');

-- ====================================================================
-- 2. Revoke Unnecessary Privileges from 'anon' (Zero Trust / Client Direct Access Revocation)
-- ====================================================================
REVOKE ALL ON public.creative_bundles FROM anon;
REVOKE ALL ON public.creative_bundle_media FROM anon;
REVOKE ALL ON public.publish_renditions FROM anon;
REVOKE ALL ON public.provider_delivery_leases FROM anon;
REVOKE ALL ON public.verified_proof_receipts FROM anon;

-- ====================================================================
-- 3. Revoke CUD Mutations from 'authenticated' (Server-Only Mutation Boundary)
-- ====================================================================
REVOKE ALL ON public.creative_bundles FROM authenticated;
REVOKE ALL ON public.creative_bundle_media FROM authenticated;
REVOKE ALL ON public.publish_renditions FROM authenticated;
REVOKE ALL ON public.provider_delivery_leases FROM authenticated;
REVOKE ALL ON public.verified_proof_receipts FROM authenticated;

-- Allow authenticated users SELECT only for legitimate workspace-scoped reading
GRANT SELECT ON public.creative_bundles TO authenticated;
GRANT SELECT ON public.creative_bundle_media TO authenticated;
GRANT SELECT ON public.publish_renditions TO authenticated;
GRANT SELECT ON public.provider_delivery_leases TO authenticated;
GRANT SELECT ON public.verified_proof_receipts TO authenticated;

-- Ensure service_role has full CUD permissions for server command APIs & background workers
GRANT ALL ON public.creative_bundles TO service_role;
GRANT ALL ON public.creative_bundle_media TO service_role;
GRANT ALL ON public.publish_renditions TO service_role;
GRANT ALL ON public.provider_delivery_leases TO service_role;
GRANT ALL ON public.verified_proof_receipts TO service_role;

-- ====================================================================
-- 4. Tighten Row Level Security (RLS) Policies
-- ====================================================================

-- 4.1 creative_bundles
DROP POLICY IF EXISTS "workspaces_access_creative_bundles" ON public.creative_bundles;
DROP POLICY IF EXISTS "workspaces_select_creative_bundles" ON public.creative_bundles;
CREATE POLICY "workspaces_select_creative_bundles" ON public.creative_bundles
  FOR SELECT TO authenticated
  USING (workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "service_role_all_creative_bundles" ON public.creative_bundles;
CREATE POLICY "service_role_all_creative_bundles" ON public.creative_bundles
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 4.2 creative_bundle_media
DROP POLICY IF EXISTS "workspaces_access_creative_bundle_media" ON public.creative_bundle_media;
DROP POLICY IF EXISTS "workspaces_select_creative_bundle_media" ON public.creative_bundle_media;
CREATE POLICY "workspaces_select_creative_bundle_media" ON public.creative_bundle_media
  FOR SELECT TO authenticated
  USING (bundle_id IN (
    SELECT id FROM public.creative_bundles WHERE workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  ));

DROP POLICY IF EXISTS "service_role_all_creative_bundle_media" ON public.creative_bundle_media;
CREATE POLICY "service_role_all_creative_bundle_media" ON public.creative_bundle_media
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 4.3 publish_renditions
DROP POLICY IF EXISTS "workspaces_access_publish_renditions" ON public.publish_renditions;
DROP POLICY IF EXISTS "workspaces_select_publish_renditions" ON public.publish_renditions;
CREATE POLICY "workspaces_select_publish_renditions" ON public.publish_renditions
  FOR SELECT TO authenticated
  USING (workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "service_role_all_publish_renditions" ON public.publish_renditions;
CREATE POLICY "service_role_all_publish_renditions" ON public.publish_renditions
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 4.4 provider_delivery_leases
DROP POLICY IF EXISTS "workspaces_access_provider_delivery_leases" ON public.provider_delivery_leases;
DROP POLICY IF EXISTS "workspaces_select_provider_delivery_leases" ON public.provider_delivery_leases;
CREATE POLICY "workspaces_select_provider_delivery_leases" ON public.provider_delivery_leases
  FOR SELECT TO authenticated
  USING (workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "service_role_all_provider_delivery_leases" ON public.provider_delivery_leases;
CREATE POLICY "service_role_all_provider_delivery_leases" ON public.provider_delivery_leases
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 4.5 verified_proof_receipts
DROP POLICY IF EXISTS "receipts_tenant_isolation" ON public.verified_proof_receipts;
DROP POLICY IF EXISTS "workspaces_select_verified_proof_receipts" ON public.verified_proof_receipts;
CREATE POLICY "workspaces_select_verified_proof_receipts" ON public.verified_proof_receipts
  FOR SELECT TO authenticated
  USING (workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "service_role_all_verified_proof_receipts" ON public.verified_proof_receipts;
CREATE POLICY "service_role_all_verified_proof_receipts" ON public.verified_proof_receipts
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ====================================================================
-- 5. DB Invariant Guard: CreativeBundle Approval Transition Verification
-- ====================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_creative_bundles_approval_evidence'
  ) THEN
    ALTER TABLE public.creative_bundles
      ADD CONSTRAINT chk_creative_bundles_approval_evidence
      CHECK (
        (approval_status != 'APPROVED') OR (
          approved_fingerprint IS NOT NULL
          AND approved_fingerprint = bundle_fingerprint
          AND approved_at IS NOT NULL
          AND approved_by IS NOT NULL
        )
      );
  END IF;
END $$;
