import type { RevisitPreparation } from '@/features/crm/revisit-preparation'

/**
 * Recipients that may enter an owner-reviewed MARKETING proposal: only candidates whose marketing consent
 * is GRANTED and whose visit is recorded. This prepares an audience; it never sends. The policy gate
 * re-checks consent for every recipient before approval can proceed.
 */
export function eligibleRevisitRecipients(preparation: RevisitPreparation): { recipientRefs: string[]; consentReviewCount: number } {
  if (preparation.status !== 'PREPARED') return { recipientRefs: [], consentReviewCount: 0 }
  return {
    recipientRefs: preparation.candidates.filter(c => c.kind === 'OWNER_REVIEW_REVISIT').map(c => c.customerId),
    consentReviewCount: preparation.candidates.filter(c => c.kind === 'REVIEW_CONSENT').length,
  }
}
