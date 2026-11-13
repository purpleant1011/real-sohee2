import { describe, expect, it, vi } from 'vitest'
import {
  getInstagramMessage,
  getInstagramProfileIds,
  listInstagramConversationMessageIds,
  listInstagramConversations,
  MetaProviderError,
} from './meta-api'

const TOKEN = 'token-1234567890'

function jsonFetcher(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as any
}

describe('listInstagramConversations', () => {
  it('parses the documented shape, normalizes unix and ISO timestamps, and requests platform=instagram', async () => {
    const fetcher = jsonFetcher(200, { data: [
      { id: 'conv-1', updated_time: '2026-10-10T01:00:00+0000' },
      { id: 'conv-2', updated_time: 1760058000 },
    ] })
    const out = await listInstagramConversations({ accessToken: TOKEN, limit: 10, fetcher })
    expect(out.map((c) => c.id)).toEqual(['conv-1', 'conv-2'])
    expect(out[0].updatedTime).toBe('2026-10-10T01:00:00.000Z')
    expect(out[1].updatedTime).toBe(new Date(1760058000 * 1000).toISOString())
    const url = String(fetcher.mock.calls[0][0])
    expect(url).toContain('https://graph.instagram.com/v26.0/me/conversations')
    expect(url).toContain('platform=instagram')
    expect(url).toContain('limit=10')
    expect(fetcher.mock.calls[0][1].headers.authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('maps provider failures to MetaProviderError codes', async () => {
    await expect(listInstagramConversations({ accessToken: TOKEN, fetcher: jsonFetcher(429, {}) }))
      .rejects.toMatchObject({ code: 'RATE_LIMITED' })
    await expect(listInstagramConversations({ accessToken: TOKEN, fetcher: jsonFetcher(401, {}) }))
      .rejects.toMatchObject({ code: 'TOKEN_EXPIRED' })
    await expect(listInstagramConversations({ accessToken: TOKEN, fetcher: jsonFetcher(500, {}) }))
      .rejects.toMatchObject({ code: 'TEMPORARY_NETWORK' })
    await expect(listInstagramConversations({ accessToken: TOKEN, fetcher: jsonFetcher(200, { nope: true }) }))
      .rejects.toMatchObject({ code: 'PROVIDER_REJECTED' })
  })

  it('rejects an unusable access token before calling the network', async () => {
    const fetcher = jsonFetcher(200, { data: [] })
    await expect(listInstagramConversations({ accessToken: 'x', fetcher })).rejects.toBeInstanceOf(MetaProviderError)
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('listInstagramConversationMessageIds', () => {
  it('returns message ids with created times from fields=messages', async () => {
    const fetcher = jsonFetcher(200, { id: 'conv-1', messages: { data: [
      { id: 'mid-b', created_time: '2026-10-10T02:00:00+0000' },
      { id: 'mid-a', created_time: '2026-10-10T01:00:00+0000' },
    ] } })
    const out = await listInstagramConversationMessageIds({ conversationId: 'conv-1', accessToken: TOKEN, fetcher })
    expect(out).toEqual([
      { id: 'mid-b', createdAt: '2026-10-10T02:00:00.000Z' },
      { id: 'mid-a', createdAt: '2026-10-10T01:00:00.000Z' },
    ])
    expect(String(fetcher.mock.calls[0][0])).toContain('/conv-1?fields=messages')
  })

  it('treats a conversation without messages as empty', async () => {
    const out = await listInstagramConversationMessageIds({
      conversationId: 'conv-1', accessToken: TOKEN, fetcher: jsonFetcher(200, { id: 'conv-1' }),
    })
    expect(out).toEqual([])
  })
})

describe('getInstagramMessage', () => {
  it('parses the documented message shape', async () => {
    const fetcher = jsonFetcher(200, {
      id: 'mid-a', created_time: '2026-10-10T01:00:00+0000', message: '안녕하세요',
      from: { id: 'cust-1', username: 'minji.studio' }, to: { data: [{ id: 'biz-1', username: 'shop' }] },
    })
    const out = await getInstagramMessage({ messageId: 'mid-a', accessToken: TOKEN, fetcher })
    expect(out).toEqual({
      id: 'mid-a', createdAt: '2026-10-10T01:00:00.000Z', text: '안녕하세요',
      fromId: 'cust-1', fromUsername: 'minji.studio', toId: 'biz-1',
    })
    expect(String(fetcher.mock.calls[0][0])).toContain('fields=id%2Ccreated_time%2Cfrom%2Cto%2Cmessage')
  })

  it('returns null for a deleted or unavailable message (older than the latest 20)', async () => {
    const out = await getInstagramMessage({
      messageId: 'mid-old', accessToken: TOKEN,
      fetcher: jsonFetcher(400, { error: { message: 'message deleted', code: 100 } }),
    })
    expect(out).toBeNull()
  })

  it('still maps rate limiting and token errors', async () => {
    await expect(getInstagramMessage({ messageId: 'm', accessToken: TOKEN, fetcher: jsonFetcher(429, {}) }))
      .rejects.toMatchObject({ code: 'RATE_LIMITED' })
    await expect(getInstagramMessage({ messageId: 'm', accessToken: TOKEN, fetcher: jsonFetcher(403, {}) }))
      .rejects.toMatchObject({ code: 'TOKEN_EXPIRED' })
  })
})

describe('getInstagramProfileIds', () => {
  it('parses top-level id, user_id, and username', async () => {
    const fetcher = jsonFetcher(200, { id: '2819', user_id: '17841', username: 'shop' })
    const out = await getInstagramProfileIds({ accessToken: TOKEN, fetcher })
    expect(out).toEqual({
      appScopedId: '2819',
      professionalId: '17841',
      username: 'shop',
    })
  })

  it('parses wrapped data array and stringifies numeric ids', async () => {
    const fetcher = jsonFetcher(200, { data: [{ user_id: 17841, username: 'shop' }] })
    const out = await getInstagramProfileIds({ accessToken: TOKEN, fetcher })
    expect(out).toEqual({
      appScopedId: null,
      professionalId: '17841',
      username: 'shop',
    })
  })

  it('returns professionalId as null when user_id is missing', async () => {
    const fetcher = jsonFetcher(200, { id: '2819', username: 'shop' })
    const out = await getInstagramProfileIds({ accessToken: TOKEN, fetcher })
    expect(out.professionalId).toBeNull()
    expect(out.appScopedId).toBe('2819')
  })

  it('maps 429 to RATE_LIMITED and 401 to TOKEN_EXPIRED', async () => {
    await expect(getInstagramProfileIds({ accessToken: TOKEN, fetcher: jsonFetcher(429, {}) }))
      .rejects.toMatchObject({ code: 'RATE_LIMITED' })
    await expect(getInstagramProfileIds({ accessToken: TOKEN, fetcher: jsonFetcher(401, {}) }))
      .rejects.toMatchObject({ code: 'TOKEN_EXPIRED' })
  })

  it('requests fields=id,user_id,username with Authorization Bearer header', async () => {
    const fetcher = jsonFetcher(200, { id: '2819' })
    await getInstagramProfileIds({ accessToken: TOKEN, fetcher })
    const url = String(fetcher.mock.calls[0][0])
    expect(url).toContain('https://graph.instagram.com/v26.0/me?fields=')
    expect(url).toContain(encodeURIComponent('id,user_id,username'))
    expect(fetcher.mock.calls[0][1].headers.authorization).toBe(`Bearer ${TOKEN}`)
  })
})

