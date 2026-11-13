import { describe, expect, it } from 'vitest'
import { proposeFirstPostMission } from './conversational-first-post'
import type { SoheeReadinessSnapshot } from '@/features/sohee-ready/types'

const facts = Object.fromEntries(['BUSINESS_VERIFIED', 'INSTAGRAM_VERIFIED', 'THREADS_VERIFIED', 'BUSINESS_KNOWLEDGE_CONFIRMED', 'TEXT_HARNESS_CONFIRMED', 'IMAGE_HARNESS_CONFIRMED', 'OPERATING_POLICY_CONFIRMED'].map(key => [key, { verified: ['BUSINESS_KNOWLEDGE_CONFIRMED', 'TEXT_HARNESS_CONFIRMED', 'IMAGE_HARNESS_CONFIRMED', 'OPERATING_POLICY_CONFIRMED'].includes(key) }])) as unknown as SoheeReadinessSnapshot['facts']
const readiness = { ready: false, facts, blockers: [], workspaceId: 'ws-1', evaluatedAt: new Date().toISOString() } as SoheeReadinessSnapshot
const params = { workspaceId: 'ws-1', readiness, admission: 'DRAFT' as const, connectedChannels: [], knowledgeSnapshot: { businessName: '우리 가게' }, textHarnessSnapshot: { brandVoice: '친절한' }, imageHarnessSnapshot: { goldenImageIds: ['img-1'], rightsStatus: 'OWNED' as const, consentStatus: 'CONFIRMED' as const }, operatingPolicySnapshot: { publishApprovalLevel: 'MANUAL' } }

describe('first post draft admission', () => {
  it('proposes with zero verified channels without changing publish admission', () => {
    const draft = proposeFirstPostMission(params)
    expect(draft.channels).toEqual([])
    expect(draft.status).toBe('AWAITING_EXACT_APPROVAL')
    expect(() => proposeFirstPostMission({ ...params, admission: undefined })).toThrow()
  })
})
