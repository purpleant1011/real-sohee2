-- ============================================================================
-- Migration: 20261021060000_business_verifications_start_date_column.sql
-- Issue: ANI-1585 / Signup & Business Submission Field Integrity
-- Purpose: Ensure start_date column exists in public.business_verifications
-- ============================================================================

ALTER TABLE public.business_verifications
  ADD COLUMN IF NOT EXISTS start_date VARCHAR(8);

COMMENT ON COLUMN public.business_verifications.start_date IS '개업일자 (8자리 숫자: YYYYMMDD)';
