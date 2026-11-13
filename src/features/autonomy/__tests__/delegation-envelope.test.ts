import { describe, it, expect } from 'vitest'
import { generateMinimalEnvelopeProposal } from '../delegation-envelope'

describe('generateMinimalEnvelopeProposal', () => {
  it('generates proposal with human readable summary stating draft preparation instead of auto reply', () => {
    const proposal = generateMinimalEnvelopeProposal(
      'ws-1',
      {
        actionKind: 'REPLY_INQUIRY',
        channel: 'INSTAGRAM_DM',
        estimatedCredits: 10,
      },
      'owner-1'
    )

    expect(proposal.humanReadableSummary).not.toContain('자동 응대')
    expect(proposal.humanReadableSummary).toContain('단순 문의 답변 초안 준비')
  })
})
