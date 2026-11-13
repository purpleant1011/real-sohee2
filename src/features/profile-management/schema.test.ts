import { describe, expect, it } from 'vitest'

import { profileChangeProposalSchema } from './schema'

const validProposal = {
  workspaceId: '10000000-0000-4000-8000-000000000001',
  channel: 'naver_place',
  targetExternalId: 'place-123',
  targetLabel: '소희 뷰티 성수점',
  field: 'business_hours',
  before: '월-금 10:00-19:00',
  after: '월-금 10:00-20:00',
  reason: '영업시간을 명확하게 표시',
  capability: 'manual_assist_only',
  evidenceUrl: 'https://help.naver.com/service/30026/contents/20379?lang=ko&osType=PC',
}

describe('profile change proposal schema', () => {
  it('requires exact before and after values for profile edits', () => {
    expect(profileChangeProposalSchema.safeParse({
      ...validProposal,
      before: null,
      after: null,
    }).success).toBe(false)
  })

  it('rejects non-official evidence URLs and unknown fields', () => {
    expect(profileChangeProposalSchema.safeParse(validProposal).success).toBe(true)
    expect(profileChangeProposalSchema.safeParse({
      ...validProposal,
      evidenceUrl: 'https://example.test/not-official',
    }).success).toBe(false)
    expect(profileChangeProposalSchema.safeParse({ ...validProposal, password: 'never-store' }).success).toBe(false)
  })
})
