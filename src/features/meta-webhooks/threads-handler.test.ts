import { describe, expect, it, vi } from 'vitest'
import { handleMetaWebhook, type NormalizedMetaEvent } from './handler'

const encoder = new TextEncoder()

async function signature(secret: string, body: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)))
  return `sha256=${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`
}

describe('Threads webhook intake', () => {
  it('normalizes reply and mention events and ignores unsupported DM shapes', async () => {
    const body = JSON.stringify({
      object: 'threads',
      entry: [{
        id: 'threads-user-1',
        time: 1723456789,
        changes: [
          { field: 'replies', value: { id: 'reply-1', text: '댓글입니다', replied_to: { id: 'post-1' }, profile: 'private-profile-field' } },
          { field: 'mentions', value: { id: 'mention-1', text: '@sohee 질문', root_post: { id: 'post-2' }, email: 'private-profile-field' } },
          { field: 'messages', value: { id: 'unsupported-dm' } },
        ],
      }],
    })
    const record = vi.fn(async (events: readonly NormalizedMetaEvent[]) => { void events })
    const response = await handleMetaWebhook(
      new Request('https://example.com/api/webhooks/threads', {
        method: 'POST',
        body,
        headers: { 'x-hub-signature-256': await signature('app-secret', body) },
      }),
      { provider: 'threads', verifyToken: 'verify-token', appSecret: 'app-secret', eventStore: { record } },
    )

    expect(response.status).toBe(200)
    const events = record.mock.calls[0]?.[0]
    expect(JSON.stringify(events)).not.toContain('private-profile-field')
    expect(record).toHaveBeenCalledWith([
      expect.objectContaining({
        category: 'reply', eventKey: 'threads:reply:reply-1', providerPostReference: 'post-1',
        payload: { id: 'reply-1', text: '댓글입니다', targetId: 'post-1' },
      }),
      expect.objectContaining({
        category: 'mention', eventKey: 'threads:mention:mention-1', providerPostReference: 'post-2',
        payload: { id: 'mention-1', text: '@sohee 질문', targetId: 'post-2' },
      }),
    ])
  })
})
