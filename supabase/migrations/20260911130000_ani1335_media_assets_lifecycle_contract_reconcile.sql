-- ==============================================================================
-- Migration: 20260911130000_ani1335_media_assets_lifecycle_contract_reconcile.sql
-- Issue: ANI-1335 / REM-10 (Linked to ANI-1284 / E2E-12)
-- Purpose: Reconcile self-contradictory media_assets schema where DEFAULT was
--          'PENDING_VALIDATION' but CHECK CONSTRAINT omitted 'PENDING_VALIDATION'.
-- Compatibility:
--   - Forward Compatibility: Adds PENDING_VALIDATION & PUBLISHED without removing any existing valid states.
--   - Backward Compatibility: Fully retains READY, ACTIVE, SUPERSEDED, QUARANTINED, FAILED, DELETED.
--   - Current Main: Eliminates code 23514 check violation on default inserts.
-- ==============================================================================

BEGIN;

-- 1. Drop existing check constraint if present
ALTER TABLE public.media_assets 
  DROP CONSTRAINT IF EXISTS media_assets_lifecycle_status_check;

-- 2. Add reconciled check constraint containing canonical V0.91 vocabulary
ALTER TABLE public.media_assets 
  ADD CONSTRAINT media_assets_lifecycle_status_check 
  CHECK (lifecycle_status IN (
    'PENDING_VALIDATION',
    'READY',
    'ACTIVE',
    'SUPERSEDED',
    'QUARANTINED',
    'FAILED',
    'DELETED',
    'PUBLISHED'
  ));

-- 3. Ensure column default is explicitly PENDING_VALIDATION (consistent with ANI-1113)
ALTER TABLE public.media_assets 
  ALTER COLUMN lifecycle_status SET DEFAULT 'PENDING_VALIDATION';

-- 4. Comment for schema governance
COMMENT ON CONSTRAINT media_assets_lifecycle_status_check ON public.media_assets IS 
  'ANI-1335 / REM-10: Canonical lifecycle status check constraint aligned with PENDING_VALIDATION default.';

COMMIT;
