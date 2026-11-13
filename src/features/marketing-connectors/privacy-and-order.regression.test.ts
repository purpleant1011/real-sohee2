import { describe, expect, it } from 'vitest'
import { selectUsableEvidence, type ConnectorEvidence } from './evidence'
import { buildConnectorOpportunity } from './opportunities'

const base: ConnectorEvidence = { id: 'ev1', workspaceId: 'wa', connectorId: 'instagram', sourceId: 'same-source', revision: '1', consentGeneration: 2, observedAt: '2026-11-09T00:00:00Z', expiresAt: '2026-11-20T00:00:00Z', purpose: 'marketing', text: '행사 공지', derivedFromGoogle: false, revokedAt: null }
const now = '2026-11-10T12:00:00Z'
const consents = [{ connectorId: 'instagram' as const, consentGeneration: 2, purpose: 'marketing' as const }]
const build = (evidence: readonly ConnectorEvidence[], currentConsents = consents) => buildConnectorOpportunity({ workspaceId: 'wa', now, evidence, currentConsents })

describe('connector evidence privacy and deterministic identity', () => {
  it('quarantines a source with a malformed replacement observation rather than reviving older facts', () => {
    expect(selectUsableEvidence({ workspaceId: 'wa', connectorId: 'instagram', consentGeneration: 2, purpose: 'marketing', now, evidence: [base, { ...base, id: 'ev2', revision: '2', observedAt: 'garbage' }] })).toEqual([])
  })
  it('does not let another workspace prefix consume this workspace evidence budget', () => {
    const unrelated = Array.from({ length: 100 }, (_, i) => ({ ...base, id: `other-${i}`, sourceId: `other-${i}`, workspaceId: 'other' }))
    expect(selectUsableEvidence({ workspaceId: 'wa', connectorId: 'instagram', consentGeneration: 2, purpose: 'marketing', now, evidence: [...unrelated, base] }).map(x => x.id)).toEqual(['ev1'])
  })
  it('does not copy customer identities or alternate phone formats into suggestion titles', () => {
    const result = build([{ ...base, text: '행사 고객 홍길동 010 1234 5678, 010.4321.8765, +82 10-1234-5678' }])
    expect(result).toHaveLength(1)
    expect(JSON.stringify(result)).not.toMatch(/홍길동|010 1234|010\.4321|\+82 10/)
  })
  it('uses connector and revision in suggestion identity', () => {
    const ig = build([base])[0]
    const th = buildConnectorOpportunity({ workspaceId: 'wa', now, evidence: [{ ...base, connectorId: 'threads' }], currentConsents: [{ connectorId: 'threads', consentGeneration: 2, purpose: 'marketing' }] })[0]
    const newRevision = build([{ ...base, revision: '2' }])[0]
    expect(ig.id).not.toBe(th.id)
    expect(ig.id).not.toBe(newRevision.id)
  })
  it('rejects conflicting authoritative consent generations for one provider and purpose', () => {
    expect(build([base, { ...base, id: 'old-generation', sourceId: 'old-source', consentGeneration: 1 }], [...consents, { ...consents[0], consentGeneration: 1 }])).toEqual([])
  })
})
