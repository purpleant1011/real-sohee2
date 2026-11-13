import { describe, expect, it, vi } from 'vitest'
import { proposeChannelHarness } from './channel-harness-proposal'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const harness = {
  businessFacts: [{ factId: '20000000-0000-4000-8000-000000000001', statement: '검증된 사업 사실' }],
  persuasion: { audience: '고객', promise: '가치', objections: ['가격'] },
  textByChannel: { instagram: { purpose: '목적', hook: '첫 문장', structure: ['도입'], tone: '차분함', cta: '문의', prohibitedPhrases: ['과장'] } },
  imageByChannel: { instagram: { aspectRatio: '4:5', subject: '도구', composition: '정면', avoid: ['고객 얼굴'] } },
  continuity: { series: '시리즈', recentTopics: [], nextTopic: '다음', repetitionRisk: 'low' as const },
  performanceLearning: { observedSignals: [], hypothesis: '가설' },
  sourceFactIds: ['20000000-0000-4000-8000-000000000001'],
  limitations: ['제안입니다.'],
}

describe('proposeChannelHarness', () => {
  it('saves only a review candidate after reserving credits', async () => {
    const saveCandidate = vi.fn(async () => ({ ruleId: '30000000-0000-4000-8000-000000000001', status: 'review_required' as const }))
    const result = await proposeChannelHarness({ workspaceId }, {
      facts: { listApproved: async () => harness.sourceFactIds },
      credits: { reserve: async () => ({ reservationId: 'r1' }), settle: async () => undefined, release: async () => undefined },
      provider: { propose: async () => harness },
      repository: { saveCandidate },
    })
    expect(result.data?.status).toBe('review_required')
    expect(saveCandidate).toHaveBeenCalledWith(expect.objectContaining({ status: 'review_required' }))
  })

  it('releases a reservation when the provider fails', async () => {
    const release = vi.fn(async () => undefined)
    await expect(proposeChannelHarness({ workspaceId }, {
      facts: { listApproved: async () => harness.sourceFactIds },
      credits: { reserve: async () => ({ reservationId: 'r1' }), settle: async () => undefined, release },
      provider: { propose: async () => { throw new Error('provider failed') } },
      repository: { saveCandidate: async () => ({ ruleId: 'unused', status: 'review_required' as const }) },
    })).resolves.toMatchObject({ error: { requestId: 'channel-harness-provider' } })
    expect(release).toHaveBeenCalledWith('r1')
  })
})
