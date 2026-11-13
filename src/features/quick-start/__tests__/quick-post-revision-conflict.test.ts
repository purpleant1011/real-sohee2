import { describe, expect, it } from 'vitest'
import { QuickPostError, reviseQuickDraft } from '../quick-post-service'

const mission = {
  id: 'm', status: 'AWAITING_APPROVAL', created_at: '2026-10-23T00:00:00Z',
  metadata: { quick: { revision: 6, topic: 't' }, payload: { copies: { instagram: { caption: '서버 최신' }, threads: { content: '글' } }, workspaceId: 'w', missionId: 'm', imageIds: [], channels: [], boundVersions: {}, rights: {} } },
}
function admin() {
  const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: mission, error: null }) }
  return { from: () => chain, rpc: () => ({ data: null, error: null }) } as any
}
const base = { workspaceId: 'w', userId: 'u', missionId: 'm', feedback: '', scope: 'text' as const, manualCopies: { instagram: { caption: '내 수정' }, threads: { content: '글' } } }

describe('G1 PATCH quick-post expectedRevision', () => {
  it('stale expectedRevision → 409 REVISION_CONFLICT with server latest, before any write/credit', async () => {
    const err = await reviseQuickDraft({ admin: admin(), ...base, expectedRevision: 3 }).catch((e) => e)
    expect(err).toBeInstanceOf(QuickPostError)
    expect(err.code).toBe('REVISION_CONFLICT')
    expect(err.status).toBe(409)
    expect(err.details?.latest).toMatchObject({ copies: { instagram: { caption: '서버 최신' } } })
  })
  it('matching expectedRevision passes the conflict guard (stops at total-revision cap, not 409 conflict)', async () => {
    const err = await reviseQuickDraft({ admin: admin(), ...base, expectedRevision: 6 }).catch((e) => e)
    expect(err.code).not.toBe('REVISION_CONFLICT')
  })
})
