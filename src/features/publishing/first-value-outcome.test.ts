import { describe, expect, it } from 'vitest'
import { firstValuePublishOutcome } from './first-value-outcome'

describe('first-value provider evidence projection', () => {
  it('does not trust an aggregate success without channel evidence', () => {
    const result = firstValuePublishOutcome(['threads'], { overallStatus: 'ALL_VERIFIED', receipts: {} })
    expect(result.verified).toBe(false)
    expect(result.overallStatus).toBe('RESULT_UNKNOWN')
  })

  it.each([
    { stage: 'PROVIDER_ACCEPTED', providerPostId: 'post-1', verifiedAt: '2026-10-23T00:00:00.000Z' },
    { stage: 'EXTERNALLY_VERIFIED', permalink: 'https://threads.net/p/1', verifiedAt: '2026-10-23T00:00:00.000Z' },
    { stage: 'EXTERNALLY_VERIFIED', providerPostId: 'post-1', verifiedAt: '2026-10-23T00:00:00.000Z' },
    { stage: 'RESULT_UNKNOWN', providerPostId: 'post-1', verifiedAt: '2026-10-23T00:00:00.000Z' },
  ])('requires independent readback, a provider ID and a URL: %j', (receipt) => {
    const result = firstValuePublishOutcome(['threads'], { receipts: { threads: receipt } })
    expect(result.verified).toBe(false)
    expect(result.results[0].status).toBe('RESULT_UNKNOWN')
  })

  it.each([
    { label: 'no readback timestamp', receipt: { stage: 'EXTERNALLY_VERIFIED', providerPostId: 'post-1', permalink: 'https://threads.net/p/1' } },
    { label: 'blank readback timestamp', receipt: { stage: 'EXTERNALLY_VERIFIED', providerPostId: 'post-1', permalink: 'https://threads.net/p/1', verifiedAt: '   ' } },
  ])('stays unverified without a recorded readback time: $label', ({ receipt }) => {
    const result = firstValuePublishOutcome(['threads'], { receipts: { threads: receipt } })
    expect(result.verified).toBe(false)
    expect(result.overallStatus).toBe('RESULT_UNKNOWN')
    expect(result.results[0].status).toBe('RESULT_UNKNOWN')
    expect(result.results[0].verifiedAt).toBeNull()
    expect(result.permalink).toBeNull()
  })

  it('keeps channel outcomes independent', () => {
    const result = firstValuePublishOutcome(['instagram', 'threads'], { receipts: {
      instagram: {
        stage: 'EXTERNALLY_VERIFIED', providerPostId: 'ig-1',
        permalink: 'https://instagram.com/p/1', verifiedAt: '2026-10-23T00:00:00.000Z',
      },
      threads: { stage: 'PROVIDER_ACCEPTED', providerPostId: 'th-1' },
    } })
    expect(result.verified).toBe(false)
    expect(result.overallStatus).toBe('PARTIAL_SUCCESS')
    expect(result.results.map((r) => r.status)).toEqual(['VERIFIED', 'RESULT_UNKNOWN'])
  })

  it('downgrades a channel whose readback timestamp is missing while another is complete', () => {
    const result = firstValuePublishOutcome(['instagram', 'threads'], { receipts: {
      instagram: {
        stage: 'EXTERNALLY_VERIFIED', providerPostId: 'ig-1',
        permalink: 'https://instagram.com/p/1', verifiedAt: '2026-10-23T00:00:00.000Z',
      },
      threads: { stage: 'EXTERNALLY_VERIFIED', providerPostId: 'th-1', permalink: 'https://threads.net/p/1' },
    } })
    expect(result.verified).toBe(false)
    expect(result.overallStatus).toBe('PARTIAL_SUCCESS')
    expect(result.results.map((r) => r.status)).toEqual(['VERIFIED', 'RESULT_UNKNOWN'])
    expect(result.results[1].verifiedAt).toBeNull()
  })

  it('confirms one channel only with its complete evidence', () => {
    const result = firstValuePublishOutcome(['threads'], { receipts: {
      threads: {
        stage: 'EXTERNALLY_VERIFIED', providerPostId: 'th-1',
        permalink: 'https://threads.net/p/1', verifiedAt: '2026-10-23T00:00:00.000Z',
      },
    } })
    expect(result.verified).toBe(true)
    expect(result.overallStatus).toBe('ALL_VERIFIED')
    expect(result.results[0].providerPostId).toBe('th-1')
    expect(result.results[0].verifiedAt).toBe('2026-10-23T00:00:00.000Z')
  })
})
