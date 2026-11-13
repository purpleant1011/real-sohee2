/**
 * Provider Readback & Verification Shared Types (Wave 5)
 */

export type VerificationOutcome =
  | 'VERIFIED'
  | 'MANUAL_REVIEW_REQUIRED'
  | 'VISUAL_MISMATCH'
  | 'VERIFICATION_PENDING'
  | 'RESULT_UNKNOWN'
