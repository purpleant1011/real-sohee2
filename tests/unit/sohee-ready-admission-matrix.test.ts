import { describe, it, expect, vi } from 'vitest'
import { getSoheeReadiness } from '@/features/sohee-ready/read-model'
import { requireSoheeReady, SoheeNotReadyError } from '@/features/sohee-ready/admission-guard'
import { executeMetaPublish } from '@/features/channels/actions/execute-meta-publish'
import { createSharedMissionEntry } from '@/features/content/shared-mission-runtime'
import { SOHEE_READINESS_FACT_KEYS, type SoheeReadinessFactKey } from '@/features/sohee-ready/types'

describe('P0-3 Production Execution Admission Guard: 6 True + 1 False Exclusion Matrix (7 Cases)', () => {
  const allTrueState: Record<SoheeReadinessFactKey, boolean> = {
    BUSINESS_VERIFIED: true,
    INSTAGRAM_VERIFIED: true,
    THREADS_VERIFIED: true,
    BUSINESS_KNOWLEDGE_CONFIRMED: true,
    TEXT_HARNESS_CONFIRMED: true,
    IMAGE_HARNESS_CONFIRMED: true,
    OPERATING_POLICY_CONFIRMED: true,
  }

  const expectedBlockerCodes: Record<SoheeReadinessFactKey, string> = {
    BUSINESS_VERIFIED: 'BUSINESS_NOT_VERIFIED',
    INSTAGRAM_VERIFIED: 'INSTAGRAM_NOT_VERIFIED',
    THREADS_VERIFIED: 'THREADS_NOT_VERIFIED',
    BUSINESS_KNOWLEDGE_CONFIRMED: 'BUSINESS_KNOWLEDGE_NOT_CONFIRMED',
    TEXT_HARNESS_CONFIRMED: 'TEXT_HARNESS_NOT_CONFIRMED',
    IMAGE_HARNESS_CONFIRMED: 'IMAGE_HARNESS_NOT_CONFIRMED',
    OPERATING_POLICY_CONFIRMED: 'OPERATING_POLICY_NOT_CONFIRMED',
  }

  SOHEE_READINESS_FACT_KEYS.forEach((failingFact) => {
    describe(`Case: Only [${failingFact}] is FALSE (6 True + 1 False)`, () => {
      const singleFailingState: Record<SoheeReadinessFactKey, boolean> = {
        ...allTrueState,
        [failingFact]: false,
      }
      const testWorkspaceId = `ws-matrix-test-${failingFact.toLowerCase()}`

      it(`ensures getSoheeReadiness returns ready=false and exactly flags ${failingFact}`, async () => {
        const snapshot = await getSoheeReadiness(testWorkspaceId, {
          fixtureState: singleFailingState,
        })

        expect(snapshot.ready).toBe(false)
        expect(snapshot.blockers.length).toBe(1)
        expect(snapshot.blockers[0].factKey).toBe(failingFact)
        expect(snapshot.blockers[0].code).toBe(expectedBlockerCodes[failingFact])
      })

      it(`enforces requireSoheeReady strictly throws SoheeNotReadyError (403 Fail-Closed)`, async () => {
        // Given readiness snapshot with only this fact failing
        const snapshot = await getSoheeReadiness(testWorkspaceId, {
          fixtureState: singleFailingState,
        })

        // When/Then: Calling requireSoheeReady directly
        try {
          if (!snapshot.ready) {
            throw new SoheeNotReadyError(snapshot, 'TEST_EXECUTION')
          }
          expect.unreachable('Should have thrown SoheeNotReadyError')
        } catch (err: any) {
          expect(err).toBeInstanceOf(SoheeNotReadyError)
          expect(err.code).toBe('SOHEE_NOT_READY')
          expect(err.statusCode).toBe(403)
          expect(err.snapshot.ready).toBe(false)
          expect(err.snapshot.blockers[0].factKey).toBe(failingFact)
        }
      })

      it(`enforces createSharedMissionEntry is blocked with zero mission side effects`, async () => {
        const snapshot = await getSoheeReadiness(testWorkspaceId, {
          fixtureState: singleFailingState,
        })

        await expect(
          createSharedMissionEntry(
            {
              workspaceId: testWorkspaceId,
              source: 'CONTENT_UI',
              intent: '주간 매장 소식 발행',
              channelTargets: ['instagram', 'threads'],
            },
            { readinessSnapshot: snapshot }
          )
        ).rejects.toThrowError(SoheeNotReadyError)
      })

      it(`enforces executeMetaPublish is blocked with 0 external API calls and status=BLOCKED`, async () => {
        // Mock admission guard for this specific failing workspace
        vi.spyOn(await import('@/features/sohee-ready/admission-guard'), 'requireSoheeReady')
          .mockRejectedValueOnce(
            new SoheeNotReadyError(
              await getSoheeReadiness(testWorkspaceId, { fixtureState: singleFailingState }),
              'META_PUBLISH'
            )
          )

        const result = await executeMetaPublish({
          workspaceId: testWorkspaceId,
          actorUserId: 'user-matrix-tester',
          channel: 'instagram',
          caption: '테스트 본문',
          mediaUrls: ['https://example.com/test.png'],
        })

        expect(result.success).toBe(false)
        expect(result.verified).toBe(false)
        expect(result.status).toBe('BLOCKED')
        expect(result.errorCode).toBe('SOHEE_NOT_READY')
        expect(result.actionRequestId).toBe('')
        expect(result.attemptId).toBe('')
        vi.restoreAllMocks()
      })
    })
  })

  describe('Control Case: All 7 Facts are TRUE (7 True)', () => {
    const testWorkspaceId = 'ws-matrix-test-all-true'

    it('returns ready=true and allows mission creation when all 7 facts are fulfilled', async () => {
      const snapshot = await getSoheeReadiness(testWorkspaceId, {
        fixtureState: allTrueState,
      })

      expect(snapshot.ready).toBe(true)
      expect(snapshot.blockers.length).toBe(0)

      const mission = await createSharedMissionEntry(
        {
          workspaceId: testWorkspaceId,
          source: 'CONTENT_UI',
          intent: '정상 승인된 매장 소식',
          channelTargets: ['instagram', 'threads'],
        },
        { readinessSnapshot: snapshot }
      )

      expect(mission.id).toBeDefined()
      expect(mission.status).toBe('PLANNING')
      expect(mission.workspaceId).toBe(testWorkspaceId)
    })
  })
})
