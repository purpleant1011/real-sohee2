import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockPublishProvider } from './mock-publish-provider'
import {
  publishProviderInputSchema,
  type PublishProviderInput,
} from './publish-provider'

const baseInput: PublishProviderInput = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  scheduleId: '22222222-2222-4222-8222-222222222222',
  versionId: '33333333-3333-4333-8333-333333333333',
  channelConnectionId: '44444444-4444-4444-8444-444444444444',
  channel: 'instagram',
  idempotencyKey: 'a'.repeat(64),
  contentFingerprint: 'b'.repeat(64),
  simulation: 'success',
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('mockPublishProvider', () => {
  it('declares that every result is mock-only', () => {
    expect(mockPublishProvider.mode).toBe('mock')
  })

  it.each([
    [
      'success',
      {
        ok: true,
        providerPostId: expect.stringMatching(/^mock-post-[0-9a-f]+$/),
        errorCode: null,
      },
    ],
    [
      'temporary_network',
      { ok: false, providerPostId: null, errorCode: 'TEMPORARY_NETWORK' },
    ],
    [
      'rate_limited',
      { ok: false, providerPostId: null, errorCode: 'RATE_LIMITED' },
    ],
    [
      'token_expired',
      { ok: false, providerPostId: null, errorCode: 'TOKEN_EXPIRED' },
    ],
    [
      'reapproval_required',
      { ok: false, providerPostId: null, errorCode: 'APPROVAL_STALE' },
    ],
    [
      'provider_rejected',
      { ok: false, providerPostId: null, errorCode: 'PROVIDER_REJECTED' },
    ],
  ] as const)('maps the %s simulation to its exact public result', async (simulation, expected) => {
    const result = await mockPublishProvider.publish({ ...baseInput, simulation })

    expect(result).toEqual(expected)
    expect(Object.keys(result)).toEqual(['ok', 'providerPostId', 'errorCode'])
  })

  it('returns a stable result for repeated deep-equal validated input', async () => {
    const first = await mockPublishProvider.publish(baseInput)
    const second = await mockPublishProvider.publish({ ...baseInput })

    expect(first).toEqual(second)
  })

  it('uses every success-context field without exposing complete input values', async () => {
    const probes: PublishProviderInput[] = [
      baseInput,
      { ...baseInput, workspaceId: '51111111-1111-4111-8111-111111111111' },
      { ...baseInput, scheduleId: '62222222-2222-4222-8222-222222222222' },
      { ...baseInput, versionId: '73333333-3333-4333-8333-333333333333' },
      {
        ...baseInput,
        channelConnectionId: '84444444-4444-4444-8444-444444444444',
      },
      { ...baseInput, channel: 'threads' },
      { ...baseInput, idempotencyKey: 'c'.repeat(64) },
      { ...baseInput, contentFingerprint: 'd'.repeat(64) },
    ]
    const results = await Promise.all(probes.map((input) => mockPublishProvider.publish(input)))
    const postIds = results.map((result) => {
      expect(result.ok).toBe(true)

      if (!result.ok) throw new Error('success simulation returned a failure')

      return result.providerPostId
    })
    const serialized = JSON.stringify(results)

    expect(new Set(postIds).size).toBe(probes.length)

    for (const input of probes) {
      for (const value of Object.values(input)) {
        expect(serialized).not.toContain(value)
      }
    }
  })

  it.each([
    ['malformed workspace UUID', { workspaceId: 'workspace-1' }],
    ['malformed schedule UUID', { scheduleId: 'schedule-1' }],
    ['malformed version UUID', { versionId: 'version-1' }],
    ['malformed connection UUID', { channelConnectionId: 'connection-1' }],
    ['uppercase idempotency key', { idempotencyKey: 'A'.repeat(64) }],
    ['short idempotency key', { idempotencyKey: 'a'.repeat(63) }],
    ['uppercase fingerprint', { contentFingerprint: 'B'.repeat(64) }],
    ['short fingerprint', { contentFingerprint: 'b'.repeat(63) }],
    ['unsupported channel', { channel: 'facebook' }],
    ['unsupported simulation', { simulation: 'timeout' }],
  ])('rejects %s before generating a result', async (_label, override) => {
    const input = { ...baseInput, ...override } as PublishProviderInput

    expect(publishProviderInputSchema.safeParse(input).success).toBe(false)
    await expect(mockPublishProvider.publish(input)).rejects.toThrow()
  })

  it('does not mutate a frozen caller input', async () => {
    const input = Object.freeze({ ...baseInput })
    const before = { ...input }

    await mockPublishProvider.publish(input)

    expect(input).toEqual(before)
  })

  it('does not use network, time, randomness, or global crypto', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('fetch must not be called')
    })
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now must not be called')
    })
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be called')
    })
    const cryptoGetSpy = vi.fn(() => {
      throw new Error('global crypto must not be read')
    })
    const guardedCrypto = new Proxy({}, { get: cryptoGetSpy })
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('crypto', guardedCrypto)

    await expect(mockPublishProvider.publish(baseInput)).resolves.toMatchObject({ ok: true })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(dateNowSpy).not.toHaveBeenCalled()
    expect(randomSpy).not.toHaveBeenCalled()
    expect(cryptoGetSpy).not.toHaveBeenCalled()
  })

  it('returns a fresh frozen result that one caller cannot poison', async () => {
    const first = await mockPublishProvider.publish(baseInput)
    const second = await mockPublishProvider.publish(baseInput)

    expect(first).not.toBe(second)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(second)).toBe(true)
    expect(() => {
      ;(first as { providerPostId: string | null }).providerPostId = 'poisoned'
    }).toThrow()
    expect(second).toEqual(await mockPublishProvider.publish(baseInput))
  })
})
