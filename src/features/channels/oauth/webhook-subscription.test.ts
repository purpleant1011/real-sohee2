import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  subscribeInstagramWebhooks,
  INSTAGRAM_GRAPH_VERSION,
} from './webhook-subscription'

describe('subscribeInstagramWebhooks', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('subscribes with igUserId successfully', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as Response)

    const result = await subscribeInstagramWebhooks({
      accessToken: 'EAAB_test_token_123',
      igUserId: '17841400000000001',
      fetchImpl,
    })

    expect(result).toEqual({ ok: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`https://graph.instagram.com/${INSTAGRAM_GRAPH_VERSION}/17841400000000001/subscribed_apps`)
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer EAAB_test_token_123',
    })
    const body = init?.body
    expect(body?.toString()).toContain('subscribed_fields=comments%2Cmessages%2Cmentions')
  })

  it('subscribes with me when igUserId is omitted', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as Response)

    const result = await subscribeInstagramWebhooks({
      accessToken: 'EAAB_test_token_456',
      fetchImpl,
    })

    expect(result).toEqual({ ok: true })
    const [url] = fetchImpl.mock.calls[0]
    expect(url).toBe(`https://graph.instagram.com/${INSTAGRAM_GRAPH_VERSION}/me/subscribed_apps`)
  })

  it('returns ok:false when accessToken is missing without throwing', async () => {
    const fetchImpl = vi.fn()
    const result = await subscribeInstagramWebhooks({
      accessToken: '',
      fetchImpl,
    })

    expect(result).toEqual({ ok: false, reason: 'MISSING_ACCESS_TOKEN' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns ok:false with reason code when API returns error and does not leak token', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const secretToken = 'EAAB_SUPER_SECRET_TOKEN_DO_NOT_LEAK'
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: 'Unsupported post request.',
          type: 'IGApiException',
          code: 100,
          error_subcode: 33,
          fbtrace_id: 'abc123xyz',
        },
      }),
    } as Response)

    const result = await subscribeInstagramWebhooks({
      accessToken: secretToken,
      igUserId: '17841400000000001',
      fetchImpl,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('META_ERROR_100_33')

    // console.warn 에 토큰이나 응답 본문 전체가 노출되지 않아야 함
    const allWarnCalls = warnSpy.mock.calls.flat().map((c) => (typeof c === 'string' ? c : JSON.stringify(c))).join(' ')
    expect(allWarnCalls).not.toContain(secretToken)
    expect(allWarnCalls).not.toContain('Unsupported post request.')
    expect(allWarnCalls).not.toContain('abc123xyz')
  })

  it('handles network failure gracefully without throwing and returns reason code', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const secretToken = 'EAAB_SECRET_NETWORK_TEST'
    const fetchImpl = vi.fn().mockRejectedValue(new Error('Network connection timeout'))

    const result = await subscribeInstagramWebhooks({
      accessToken: secretToken,
      igUserId: '17841400000000001',
      fetchImpl,
    })

    expect(result).toEqual({ ok: false, reason: 'NETWORK_ERROR' })
    const allWarnCalls = warnSpy.mock.calls.flat().map((c) => (typeof c === 'string' ? c : JSON.stringify(c))).join(' ')
    expect(allWarnCalls).not.toContain(secretToken)
    expect(allWarnCalls).not.toContain('Network connection timeout')
  })

  it('returns ok:false when response body is not success:true', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: false }),
    } as Response)

    const result = await subscribeInstagramWebhooks({
      accessToken: 'token-xyz',
      fetchImpl,
    })

    expect(result).toEqual({ ok: false, reason: 'SUBSCRIPTION_UNSUCCESSFUL' })
  })
})
