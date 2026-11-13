-- ============================================================================
-- Migration: 20261023100000_booking_recovery_approved_reply_snapshot.sql
-- Purpose: Add the missing booking_recovery_proposals.approved_reply_snapshot column
-- ============================================================================
--
-- Why: commit 74d26f92 ("feat(booking-recovery): wire prepareReply v2 and atomic
-- approval verification", ANI-1585 / ANI-1606 / ANI-1607) made the application persist
-- the v2 ApprovedReplyDto into booking_recovery_proposals.approved_reply_snapshot, but
-- shipped no migration. The column was never created by any migration, so the INSERT
-- fails on every database replayed from supabase/migrations:
--
--   ERROR: column "approved_reply_snapshot" of relation
--          "booking_recovery_proposals" does not exist
--
-- Writers/readers that depend on it (all evidence-backed, no inference):
--   * src/features/booking-recovery/repository.ts:670  (INSERT row field)
--   * src/features/booking-recovery/repository.ts:674  (.from('booking_recovery_proposals').insert)
--   * src/features/booking-recovery/service.ts:383     (read: !snapshot || schemaVersion !== 2 -> null)
--   * src/features/booking-recovery/service.ts:1109    (read: previous revision snapshot)
--   * src/features/booking-recovery/dm-reconcile-dependencies.ts:45 (read: legacy rows unverified)
--   * src/features/booking-recovery/contracts.ts:192   (recoveryProposalSchema: record nullable optional)
--   * src/features/booking-recovery/approved-reply.ts:17 (ApprovedReplyDto v2, an object)
--
-- Operational impact: while the column is absent, prepareReply fails with
-- INTERNAL_ERROR at the proposal INSERT, so the booking-recovery draft step is blocked
-- as soon as the feature is enabled for a workspace. The defect is live in any
-- environment whose schema was built from this repository, including production
-- (booking_recovery tables were created there from the same migrations).
--
-- Type: jsonb, matching ApprovedReplyDto (a JSON object: schemaVersion, offer, facts[]).
-- docs/launch/v093-w4-unmet-contracts.md:63 specifies "(JSONB)" for this field.
--
-- Nullability: NULL is meaningful and required. It means "no approved reply snapshot has
-- been captured for this proposal yet" - not zero, not empty, not a fabricated default.
-- Legacy proposals created before v2 remain unverified, and both readers treat NULL as
-- unverified and fail closed (service.ts:384 returns null; dm-reconcile-dependencies.ts:47
-- rejects the send). No default value is set, so nothing is invented for existing rows.
--
-- Backfill policy: nothing is backfilled. Every pre-existing row stays NULL, which the
-- application reports honestly as "not yet approved" rather than synthesising a snapshot.
--
-- Constraint: the column only ever holds a JSON object (z.record in contracts.ts:192).
-- The CHECK is safe to validate without NOT VALID because every existing row is NULL.
--
-- Rollback: ALTER TABLE public.booking_recovery_proposals DROP COLUMN IF EXISTS approved_reply_snapshot;
-- No row is deleted. Additive and forward-only; applying this file changes no operational
-- data and does not modify any other table, function or policy.
-- ============================================================================

ALTER TABLE public.booking_recovery_proposals
  ADD COLUMN IF NOT EXISTS approved_reply_snapshot jsonb
  CHECK (approved_reply_snapshot IS NULL OR jsonb_typeof(approved_reply_snapshot) = 'object');

COMMENT ON COLUMN public.booking_recovery_proposals.approved_reply_snapshot IS
  '승인된 답변 v2 스냅샷(ApprovedReplyDto). NULL = 아직 승인 스냅샷 없음(레거시/미검증). 서버가 채우며 클라이언트 입력을 저장하지 않는다.';
