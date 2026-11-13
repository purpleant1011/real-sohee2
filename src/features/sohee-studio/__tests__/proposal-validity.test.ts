import { describe, expect, it, vi } from 'vitest'
import { decideProposal } from '../repository'

const params = { workspaceId: 'workspace-a', proposalId: 'proposal-a', decision: 'confirm' as const, userId: 'owner-a' }
const validFrom = '2026-11-01T00:00:00+09:00'
const validUntil = '2026-12-01T00:00:00+09:00'

describe('owner-confirmed proposal validity', () => {
  it('passes explicit effective dates through an atomic RPC, not a second fact update', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: { success: true, id: params.proposalId, status: 'confirmed', kind: 'fact' }, error: null }), from: vi.fn() }
    await decideProposal({ ...params, validFrom, validUntil }, client)
    expect(client.rpc).toHaveBeenCalledWith('decide_studio_proposal_with_validity', expect.objectContaining({
      p_valid_from: '2026-10-31T15:00:00.000Z', p_valid_until: '2026-11-30T15:00:00.000Z',
    }))
    expect(client.from).not.toHaveBeenCalled()
  })
  it.each([
    { validFrom: '2026-11-01' },
    { validFrom: 'tomorrow' },
    { validFrom, validUntil: '2026-10-31T00:00:00+09:00' },
    { validUntil },
  ])('rejects ambiguous or inverted effective periods before any database request (%j)', async validity => {
    const client = { rpc: vi.fn(), from: vi.fn() }
    await expect(decideProposal({ ...params, ...validity }, client)).rejects.toThrow('invalid_argument')
    expect(client.rpc).not.toHaveBeenCalled()
  })
})
