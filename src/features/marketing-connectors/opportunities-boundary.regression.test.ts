import { describe, expect, it } from 'vitest'
import { buildConnectorOpportunity } from './opportunities'
import type { ConnectorEvidence } from './evidence'

const evidence: ConnectorEvidence = {
  id: 'ev-a', workspaceId: 'workspace-a', connectorId: 'instagram', sourceId: 'event-a',
  revision: '1', consentGeneration: 2, observedAt: '2026-11-09T00:00:00Z',
  expiresAt: '2026-11-20T00:00:00Z', purpose: 'marketing', text: '11월 행사 안내',
  derivedFromGoogle: false, revokedAt: null,
}
const input = { workspaceId: 'workspace-a', now: '2026-11-10T12:00:00Z',
  currentConsents: [{ connectorId: 'instagram', consentGeneration: 2, purpose: 'marketing' }] }

describe('opportunity builder security boundary', () => {
  it('rejects evidence from a different workspace even when the text contains an event', () => {
    expect(buildConnectorOpportunity({ ...input, evidence: [{ ...evidence, workspaceId: 'workspace-b' }] })).toEqual([])
  })
  it('rejects revoked and expired event facts', () => {
    expect(buildConnectorOpportunity({ ...input, evidence: [{ ...evidence, revokedAt: '2026-11-10T01:00:00Z' }] })).toEqual([])
    expect(buildConnectorOpportunity({ ...input, evidence: [{ ...evidence, expiresAt: input.now }] })).toEqual([])
  })
  it('requires current consent and rejects facts from an older consent generation', () => {
    expect(buildConnectorOpportunity({ ...input, evidence: [{ ...evidence, consentGeneration: 1 }] })).toEqual([])
    expect(buildConnectorOpportunity({ ...input, currentConsents: [], evidence: [evidence] })).toEqual([])
  })
  it('fails closed instead of throwing on malformed array members', () => {
    expect(buildConnectorOpportunity({ ...input, evidence: [null] as unknown as ConnectorEvidence[] })).toEqual([])
  })
})
