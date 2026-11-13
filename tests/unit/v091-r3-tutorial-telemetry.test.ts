import { describe, it, expect } from 'vitest'
import {
  TUTORIAL_LEARNING_EVENTS,
  createTutorialLearningSignal,
  sanitizeTutorialDimensions,
  calculateTutorialLearningMetrics,
  type TutorialLearningSignal,
} from '@/features/telemetry/tutorial-learning-telemetry'

describe('ANI-1455: Privacy-Safe Tutorial Learning Signals & Observability', () => {
  const WORKSPACE_ID = 'ws-test-telemetry-01'
  const SESSION_ID = 'sess-tutorial-abc'

  describe('1. Tutorial Learning Event Coverage (18 Events)', () => {
    it('covers all specified tutorial learning event types', () => {
      expect(TUTORIAL_LEARNING_EVENTS).toContain('tutorial_started')
      expect(TUTORIAL_LEARNING_EVENTS).toContain('tutorial_completed')
      expect(TUTORIAL_LEARNING_EVENTS).toContain('first_meeting_goal_candidate_created')
      expect(TUTORIAL_LEARNING_EVENTS).toContain('business_candidate_confirmed')
      expect(TUTORIAL_LEARNING_EVENTS).toContain('business_candidate_edited')
      expect(TUTORIAL_LEARNING_EVENTS).toContain('text_calibration_generated')
      expect(TUTORIAL_LEARNING_EVENTS).toContain('text_calibration_selected')
      expect(TUTORIAL_LEARNING_EVENTS).toContain('text_calibration_feedback')
      expect(TUTORIAL_LEARNING_EVENTS).toContain('text_calibration_regenerated')
      expect(TUTORIAL_LEARNING_EVENTS).toContain('text_calibration_confirmed')
      expect(TUTORIAL_LEARNING_EVENTS).toContain('image_calibration_generated')
      expect(TUTORIAL_LEARNING_EVENTS).toContain('image_calibration_selected')
      expect(TUTORIAL_LEARNING_EVENTS).toContain('image_calibration_feedback')
      expect(TUTORIAL_LEARNING_EVENTS).toContain('image_calibration_regenerated')
      expect(TUTORIAL_LEARNING_EVENTS).toContain('image_calibration_confirmed')
      expect(TUTORIAL_LEARNING_EVENTS).toContain('first_post_revision_count')
      expect(TUTORIAL_LEARNING_EVENTS).toContain('publish_channel_external_verified')
      expect(TUTORIAL_LEARNING_EVENTS).toContain('stage_dropoff')
    })

    it('creates immutable, structured tutorial learning signals', () => {
      const signal = createTutorialLearningSignal({
        workspaceId: WORKSPACE_ID,
        sessionId: SESSION_ID,
        eventType: 'text_calibration_selected',
        stage: 'TEXT_HARNESS',
        metrics: { iterationCount: 2 },
        dimensions: { selectedStyleId: 'style-chic-01', channel: 'DUAL' },
      })

      expect(signal.id).toBeDefined()
      expect(signal.workspaceId).toBe(WORKSPACE_ID)
      expect(signal.sessionId).toBe(SESSION_ID)
      expect(signal.eventType).toBe('text_calibration_selected')
      expect(signal.stage).toBe('TEXT_HARNESS')
      expect(signal.metrics?.iterationCount).toBe(2)
      expect(signal.dimensions?.selectedStyleId).toBe('style-chic-01')
      expect(Object.isFrozen(signal)).toBe(true)
    })
  })

  describe('2. Strict Privacy Contract & Content Separation', () => {
    it('sanitizes and redacts secret tokens, passwords, and resident registration numbers', () => {
      const rawDimensions = {
        channel: 'INSTAGRAM',
        accessToken: 'EAABw_secret_oauth_token',
        userPassword: 'plaintextPassword123!',
        residentId: '900101-1234567',
        safeCategory: 'TONE',
      }

      const clean = sanitizeTutorialDimensions(rawDimensions)

      // Secret keys must be completely filtered out
      expect(clean.accessToken).toBeUndefined()
      expect(clean.userPassword).toBeUndefined()
      // Secret/PII values under other keys must be redacted
      expect(clean.residentId).toBe('[REDACTED_SECRET]')
      // Safe dimensions preserved
      expect(clean.channel).toBe('INSTAGRAM')
      expect(clean.safeCategory).toBe('TONE')
    })

    it('truncates excessively long freeform text strings to prevent prompt/content bleed', () => {
      const veryLongPrompt = '이것은 매우 긴 사용자의 프롬프트입니다. 매장 소개를 위해 사장님이 입력한 텍스트가 텔레메트리에 통째로 유출되면 안 되므로 잘려야 합니다. 끝까지 길게 작성합니다.'.repeat(3)

      const clean = sanitizeTutorialDimensions({
        feedbackDetail: veryLongPrompt,
        feedbackCategory: 'LENGTH',
      })

      expect(clean.feedbackCategory).toBe('LENGTH')
      expect(clean.feedbackDetail.length).toBeLessThanOrEqual(67) // 64 + '...'
      expect(clean.feedbackDetail.endsWith('...')).toBe(true)
    })
  })

  describe('3. Learning Metrics & Funnel Aggregation', () => {
    it('correctly aggregates text/image regenerations, post revisions, and channel verifications', () => {
      const signals: TutorialLearningSignal[] = [
        createTutorialLearningSignal({
          workspaceId: WORKSPACE_ID,
          sessionId: 'sess-1',
          eventType: 'tutorial_started',
          stage: 'FIRST_MEETING',
        }),
        createTutorialLearningSignal({
          workspaceId: WORKSPACE_ID,
          sessionId: 'sess-1',
          eventType: 'text_calibration_regenerated',
          stage: 'TEXT_HARNESS',
          metrics: { iterationCount: 3 },
        }),
        createTutorialLearningSignal({
          workspaceId: WORKSPACE_ID,
          sessionId: 'sess-1',
          eventType: 'image_calibration_feedback',
          stage: 'IMAGE_HARNESS',
          metrics: { iterationCount: 2 },
        }),
        createTutorialLearningSignal({
          workspaceId: WORKSPACE_ID,
          sessionId: 'sess-1',
          eventType: 'first_post_revision_count',
          stage: 'FIRST_POST',
          metrics: { revisionCount: 2 },
        }),
        createTutorialLearningSignal({
          workspaceId: WORKSPACE_ID,
          sessionId: 'sess-1',
          eventType: 'publish_channel_external_verified',
          stage: 'FIRST_POST',
          dimensions: { channel: 'INSTAGRAM' },
        }),
        createTutorialLearningSignal({
          workspaceId: WORKSPACE_ID,
          sessionId: 'sess-1',
          eventType: 'publish_channel_external_verified',
          stage: 'FIRST_POST',
          dimensions: { channel: 'THREADS' },
        }),
        createTutorialLearningSignal({
          workspaceId: WORKSPACE_ID,
          sessionId: 'sess-1',
          eventType: 'tutorial_completed',
          stage: 'FIRST_POST',
        }),
      ]

      const metrics = calculateTutorialLearningMetrics(signals)

      expect(metrics.totalStarted).toBe(1)
      expect(metrics.totalCompleted).toBe(1)
      expect(metrics.completionRatePct).toBe(100)
      expect(metrics.avgTextRegenerations).toBe(3)
      expect(metrics.avgImageRegenerations).toBe(2)
      expect(metrics.avgFirstPostRevisions).toBe(2)
      expect(metrics.verifiedChannelsBreakdown.instagram).toBe(1)
      expect(metrics.verifiedChannelsBreakdown.threads).toBe(1)
    })
  })
})
