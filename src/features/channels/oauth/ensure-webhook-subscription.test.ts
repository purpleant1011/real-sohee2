import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ensureInstagramWebhookSubscription } from './ensure-webhook-subscription'

describe('ensureInstagramWebhookSubscription', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('skips subscription when webhook_status is healthy', async () => {
    const subscribeMock = vi.fn()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await ensureInstagramWebhookSubscription({
      connection: { id: 'conn-1', webhook_status: 'healthy' },
      accessToken: 'EAAB_token_123',
      igUserId: '17841400000000001',
      subscribe: subscribeMock,
    })

    expect(result).toEqual({ attempted: false })
    expect(subscribeMock).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalledWith(
      '[webhook-ensure]',
      expect.anything()
    )
  })

  it('attempts subscription when webhook_status is not healthy (e.g. pending)', async () => {
    const subscribeMock = vi.fn().mockResolvedValue({ ok: true })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await ensureInstagramWebhookSubscription({
      connection: { id: 'conn-2', webhook_status: 'pending' },
      accessToken: 'EAAB_token_123',
      igUserId: '17841400000000001',
      subscribe: subscribeMock,
    })

    expect(result).toEqual({ attempted: true, ok: true })
    expect(subscribeMock).toHaveBeenCalledTimes(1)
    expect(subscribeMock).toHaveBeenCalledWith({
      accessToken: 'EAAB_token_123',
      igUserId: '17841400000000001',
    })
    expect(warnSpy).toHaveBeenCalledWith('[webhook-ensure]', {
      channel: 'instagram',
      ok: true,
      reason: undefined,
    })
  })

  it('attempts subscription when webhook_status is null or undefined', async () => {
    const subscribeMock = vi.fn().mockResolvedValue({ ok: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await ensureInstagramWebhookSubscription({
      connection: { id: 'conn-3', webhook_status: null },
      accessToken: 'EAAB_token_123',
      igUserId: null,
      subscribe: subscribeMock,
    })

    expect(result).toEqual({ attempted: true, ok: true })
    expect(subscribeMock).toHaveBeenCalledTimes(1)
  })

  it('logs warning without sensitive token or user ID when subscription returns ok: false', async () => {
    const secretToken = 'EAAB_SUPER_SECRET_TOKEN_DO_NOT_LEAK'
    const igUserId = '17841400000000099'
    const subscribeMock = vi.fn().mockResolvedValue({
      ok: false,
      reason: 'META_ERROR_100_33',
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await ensureInstagramWebhookSubscription({
      connection: { id: 'conn-4', webhook_status: 'stale' },
      accessToken: secretToken,
      igUserId,
      subscribe: subscribeMock,
    })

    expect(result).toEqual({ attempted: true, ok: false, reason: 'META_ERROR_100_33' })
    expect(warnSpy).toHaveBeenCalledWith('[webhook-ensure]', {
      channel: 'instagram',
      ok: false,
      reason: 'META_ERROR_100_33',
    })

    const allWarnCalls = warnSpy.mock.calls
      .flat()
      .map((c) => (typeof c === 'string' ? c : JSON.stringify(c)))
      .join(' ')
    expect(allWarnCalls).not.toContain(secretToken)
    expect(allWarnCalls).not.toContain(igUserId)
  })

  it('catches unexpected subscribe rejection and does not throw', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const subscribeMock = vi.fn().mockRejectedValue(new Error('Unexpected network failure'))

    const result = await ensureInstagramWebhookSubscription({
      connection: { id: 'conn-5', webhook_status: 'error' },
      accessToken: 'EAAB_token_abc',
      igUserId: '17841400000000001',
      subscribe: subscribeMock,
    })

    expect(result).toEqual({ attempted: true, ok: false, reason: 'Unexpected network failure' })
    expect(warnSpy).toHaveBeenCalledWith('[webhook-ensure]', {
      channel: 'instagram',
      ok: false,
      reason: 'Unexpected network failure',
    })
  })
})
