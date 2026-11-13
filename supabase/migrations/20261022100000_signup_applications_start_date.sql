-- ============================================================================
-- Migration: 20261022100000_signup_applications_start_date.sql
-- Issue: signup wizard 사업자정보 step fails in production (missing column)
-- Purpose: Ensure start_date column exists in public.signup_applications
-- ============================================================================
--
-- Why: `updateSignupBusinessInfo` in src/features/auth/signup-state-machine.ts always sends the
-- `start_date` key on the signup_applications update (null when the owner leaves the opening date
-- blank). PostgREST rejects the entire request when a key has no matching column, even for null:
-- `Could not find the 'start_date' column of 'signup_applications' in the schema cache`.
-- No migration ever created this column, so /api/auth/signup-flow fails on the 사업자정보 step in
-- production and the raw PostgREST error text is surfaced to the owner.
--
-- Type: mirrors public.business_verifications.start_date (see 20261021060000) so the two tables
-- store the same shape of value (8-digit YYYYMMDD).
--
-- Nullable on purpose, no default: NULL means "the owner has not stated an opening date", which the
-- app reports honestly instead of inventing one.
--
-- Backfill policy: nothing is backfilled.
--
-- Rollback: ALTER TABLE public.signup_applications DROP COLUMN IF EXISTS start_date;
-- No row is deleted. Additive and forward-only; adding this file does not change any operational database.

ALTER TABLE public.signup_applications
  ADD COLUMN IF NOT EXISTS start_date VARCHAR(8);

COMMENT ON COLUMN public.signup_applications.start_date IS '개업일자 (8자리 숫자: YYYYMMDD)';
