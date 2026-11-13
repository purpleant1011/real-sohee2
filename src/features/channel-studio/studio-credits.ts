import { QuickPostCreditFailure, releaseQuickPostCredits, reserveQuickPostCredits, settleQuickPostCredits, type QuickPostReservation } from '@/features/quick-start/quick-post-credits'
import { ChannelDraftError } from './types'

/**
 * FinOps lifecycle for the four-channel studio: quote → reserve → execute → settle/release.
 * One text charge covers all four channels (one model call); the optional image is a separate reservation
 * that is settled only when an image was actually stored.
 */
export type StudioCreditScope = 'text' | 'image'

export interface StudioCredits {
  reserve(workspaceId: string, requestKey: string, scope: StudioCreditScope): Promise<QuickPostReservation>
  settle(workspaceId: string, reservation: QuickPostReservation): Promise<void>
  release(workspaceId: string, reservation: QuickPostReservation): Promise<void>
}

type CreditAdmin = Parameters<typeof reserveQuickPostCredits>[0]['admin']

// Text and image use different revisions because reservations are unique per (workspace, request, revision).
const REVISION: Record<StudioCreditScope, number> = { text: 1, image: 2 }
const MAX_ATTEMPTS = 10

export function createStudioCredits(admin: CreditAdmin): StudioCredits {
  return {
    async reserve(workspaceId, requestKey, scope) {
      try {
        // A retry of a failed attempt reuses the request key; its released hold is skipped, never re-charged twice.
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          const reservation = await reserveQuickPostCredits({
            admin,
            workspaceId,
            missionId: requestKey,
            revision: REVISION[scope] + attempt * 2,
            scope,
          })
          if (reservation.state !== 'released') return reservation
        }
        throw new QuickPostCreditFailure('retry limit', 'CREDIT_RESERVE_FAILED', 503)
      } catch (error) {
        if (error instanceof QuickPostCreditFailure && error.code === 'INSUFFICIENT_CREDITS') {
          throw new ChannelDraftError('크레딧이 부족해서 글을 만들 수 없어요. 크레딧을 충전한 뒤 다시 시도해 주세요.', 'INSUFFICIENT_CREDITS', 402)
        }
        throw new ChannelDraftError('크레딧을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.', 'CREDIT_UNAVAILABLE', 503)
      }
    },
    settle: (workspaceId, reservation) => settleQuickPostCredits(admin, workspaceId, reservation),
    release: async (workspaceId, reservation) => {
      await releaseQuickPostCredits(admin, workspaceId, reservation)
    },
  }
}
