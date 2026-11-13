import { describe, expect, it } from 'vitest'
import { selectUsableEvidence, type ConnectorEvidence } from './evidence'

const base: ConnectorEvidence = { id: 'old', workspaceId: 'wa', connectorId: 'instagram', sourceId: 'event', revision: '1', consentGeneration: 1, observedAt: '2026-11-09T00:00:00Z', expiresAt: '2026-11-20T00:00:00Z', purpose: 'marketing', text: '행사 안내', derivedFromGoogle: false, revokedAt: null }
const select = (evidence: readonly ConnectorEvidence[]) => selectUsableEvidence({ workspaceId: 'wa', connectorId: 'instagram', consentGeneration: 1, now: '2026-11-10T12:00:00Z', purpose: 'marketing', evidence })

describe('latest evidence validation at output cap', () => {
  it('observes a replacement revocation beyond the first hundred matching rows', () => {
    const filler = Array.from({ length: 99 }, (_, i) => ({ ...base, id: `filler-${i}`, sourceId: `other-${i}` }))
    const revoked = { ...base, id: 'new', revision: '2', observedAt: '2026-11-10T00:00:00Z', revokedAt: '2026-11-10T01:00:00Z' }
    expect(select([base, ...filler, revoked]).some(x => x.sourceId === 'event')).toBe(false)
  })
  it('rejects an empty or missing evidence identity and never revives its older revision', () => {
    expect(select([{ ...base, id: '' }])).toEqual([])
    expect(select([{ ...base, id: undefined } as unknown as ConnectorEvidence])).toEqual([])
    expect(select([base, { ...base, id: '', revision: '2', observedAt: '2026-11-10T00:00:00Z' }])).toEqual([])
  })
})
