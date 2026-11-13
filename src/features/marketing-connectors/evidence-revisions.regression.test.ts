import { describe, expect, it } from 'vitest'
import { selectUsableEvidence, type ConnectorEvidence } from './evidence'

const older: ConnectorEvidence = {
  id: 'old', workspaceId: 'workspace-a', connectorId: 'instagram', sourceId: 'event-a',
  revision: '1', consentGeneration: 2, observedAt: '2026-11-09T00:00:00Z',
  expiresAt: '2026-11-20T00:00:00Z', purpose: 'marketing', text: '행사 안내',
  derivedFromGoogle: false, revokedAt: null,
}
function select(evidence: readonly ConnectorEvidence[]) {
  return selectUsableEvidence({ workspaceId: 'workspace-a', connectorId: 'instagram',
    consentGeneration: 2, now: '2026-11-10T12:00:00Z', purpose: 'marketing', evidence })
}

describe('connector source revision invalidation', () => {
  it('does not resurrect an older fact after the newer revision is revoked', () => {
    const revoked = { ...older, id: 'new', revision: '2', observedAt: '2026-11-10T00:00:00Z', revokedAt: '2026-11-10T01:00:00Z' }
    expect(select([older, revoked])).toEqual([])
    expect(select([revoked, older])).toEqual([])
  })

  it('does not resurrect an older active offer after the replacement revision expires', () => {
    const expired = { ...older, id: 'new', revision: '2', observedAt: '2026-11-10T00:00:00Z', expiresAt: '2026-11-10T10:00:00Z' }
    expect(select([older, expired])).toEqual([])
  })

  it('fails closed on tied latest observedAt revisions and excludes the source', () => {
    const tie1 = { ...older, id: 'tie-1', revision: '1', observedAt: '2026-11-10T00:00:00Z' }
    const tie2 = { ...older, id: 'tie-2', revision: '2', observedAt: '2026-11-10T00:00:00Z' }
    expect(select([tie1, tie2])).toEqual([])
    expect(select([tie2, tie1])).toEqual([])
  })

  it('evaluates latest revision strictly within active consentGeneration (gen2 item is exposed even if gen1 has later observedAt)', () => {
    // Current connection is consentGeneration: 2
    const gen2Valid = { ...older, id: 'gen2-item', revision: '1', consentGeneration: 2, observedAt: '2026-11-10T08:00:00Z' }
    // Old connection leftover with later timestamp in generation 1
    const gen1Leftover = { ...older, id: 'gen1-item', revision: '9', consentGeneration: 1, observedAt: '2026-11-10T11:00:00Z' }
    const result = select([gen1Leftover, gen2Valid])
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('gen2-item')
  })

  it('evaluates latest revision source-wide across all purposes (newer booking revision prevents resurrecting older marketing revision)', () => {
    // older fact has purpose marketing
    const olderMarketing = { ...older, id: 'old-mkt', revision: '1', observedAt: '2026-11-10T08:00:00Z', purpose: 'marketing' as const }
    // newer fact for same source has purpose booking
    const newerBooking = { ...older, id: 'new-bk', revision: '2', observedAt: '2026-11-10T10:00:00Z', purpose: 'booking' as const }

    // When selecting for 'marketing', the source's latest revision is newerBooking (not marketing),
    // so olderMarketing must NOT be resurrected
    expect(select([olderMarketing, newerBooking])).toEqual([])
  })

  it('allows up to +300s future clock skew but quarantines at +301s boundary', () => {
    // base now in select() is '2026-11-10T12:00:00Z' (epoch 1794312000000)
    // +300s: 2026-11-10T12:05:00Z -> allowed and exposed
    const at300s = { ...older, id: 'skew-300', revision: '2', observedAt: '2026-11-10T12:05:00Z' }
    expect(select([older, at300s])).toHaveLength(1)
    expect(select([older, at300s])[0]?.id).toBe('skew-300')

    // +301s: 2026-11-10T12:05:01Z -> exceeds 300s skew: quarantined fail-closed (no older resurrection, no future exposure)
    const at301s = { ...older, id: 'skew-301', revision: '3', observedAt: '2026-11-10T12:05:01Z' }
    expect(select([older, at301s])).toEqual([])
    expect(select([at301s])).toEqual([])
  })
})
