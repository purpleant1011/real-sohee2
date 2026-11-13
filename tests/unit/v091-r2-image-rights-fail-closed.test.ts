import { describe, it, expect } from 'vitest'
import {
  proposeFirstPostMission,
} from '@/features/missions/conversational-first-post'
import type { SoheeReadinessSnapshot } from '@/features/sohee-ready/types'

describe('P0-7: Image Rights & Consent Fail-Closed', () => {
  const readySnapshot: SoheeReadinessSnapshot = {
    workspaceId: 'ws-rights-test',
    ready: true,
    facts: {
      BUSINESS_VERIFIED: { verified: true, status: 'VERIFIED' } as any,
      INSTAGRAM_VERIFIED: { verified: true, status: 'VERIFIED' } as any,
      THREADS_VERIFIED: { verified: true, status: 'VERIFIED' } as any,
      BUSINESS_KNOWLEDGE_CONFIRMED: { verified: true, status: 'CONFIRMED' } as any,
      TEXT_HARNESS_CONFIRMED: { verified: true, status: 'CONFIRMED' } as any,
      IMAGE_HARNESS_CONFIRMED: { verified: true, status: 'CONFIRMED' } as any,
      OPERATING_POLICY_CONFIRMED: { verified: true, status: 'CONFIRMED' } as any,
    },
    blockers: [],
    evaluatedAt: new Date().toISOString(),
  }

  const baseParams = {
    workspaceId: 'ws-rights-test',
    readiness: readySnapshot,
    knowledgeSnapshot: { businessName: '테스트' },
    textHarnessSnapshot: { brandVoice: '친근한' },
    operatingPolicySnapshot: {},
    connectedChannels: [
      { provider: 'instagram', handle: '@sohee_official' },
      { provider: 'threads', handle: '@sohee_official' },
    ],
  }

  it('rejects proposal when rightsStatus is missing (no fake OWNED default)', () => {
    expect(() =>
      proposeFirstPostMission({
        ...baseParams,
        imageHarnessSnapshot: {
          goldenImageIds: ['img-1'],
          // missing rightsStatus
          consentStatus: 'CONFIRMED',
        } as any,
      })
    ).toThrowError(/MISSING_RIGHTS_EVIDENCE/)
  })

  it('rejects proposal when consentStatus is missing (no fake CONFIRMED default)', () => {
    expect(() =>
      proposeFirstPostMission({
        ...baseParams,
        imageHarnessSnapshot: {
          goldenImageIds: ['img-1'],
          rightsStatus: 'OWNED',
          // missing consentStatus
        } as any,
      })
    ).toThrowError(/MISSING_CONSENT_EVIDENCE/)
  })

  it('accepts proposal when legitimate rightsStatus and consentStatus are provided', () => {
    const draft = proposeFirstPostMission({
      ...baseParams,
      imageHarnessSnapshot: {
        goldenImageIds: ['img-1'],
        rightsStatus: 'OWNED',
        consentStatus: 'CONFIRMED',
      } as any,
    })

    expect(draft.rights.rightsStatus).toBe('OWNED')
    expect(draft.rights.consentStatus).toBe('CONFIRMED')
  })
})
