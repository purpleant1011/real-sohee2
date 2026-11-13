import { describe, expect, it } from 'vitest'
import { createLearningHttpHandler, type LearningHttpDependencies } from './http'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const sourceId = '22222222-2222-4222-8222-222222222222'
const actor = { workspaceId, userId: '33333333-3333-4333-8333-333333333333', role: 'owner' }
const url = `http://localhost:3195/api/workspaces/${workspaceId}/knowledge/channels`
function request(method: string, body?: unknown, origin = 'http://localhost:3195') {
  return new Request(url, { method, headers: { origin, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) })
}
function dependencies(overrides: Partial<LearningHttpDependencies> = {}): LearningHttpDependencies {
  return { async authorize() { return actor }, async perform() { return { sources: [], capabilities: [] } }, ...overrides }
}

describe('channel learning HTTP boundary', () => {
  it('preserves auth denial and disables caching', async () => {
    const handler = createLearningHttpHandler('list', dependencies({
      async authorize() { return new Response('로그인이 필요해요.', { status: 401 }) },
    }))
    const result = await handler(request('GET'), { workspaceId })
    expect(result.status).toBe(401)
    expect(result.headers.get('cache-control')).toBe('no-store')
  })
  it('does not allow writes from another origin or a viewer', async () => {
    const data = { platform: 'instagram', url: 'https://www.instagram.com/shop/', consent: { text: true, images: false } }
    const handler = createLearningHttpHandler('register', dependencies())
    expect((await handler(request('POST', data, 'https://evil.example'), { workspaceId })).status).toBe(403)
    const viewer = createLearningHttpHandler('register', dependencies({ async authorize() { return { ...actor, role: 'viewer' } } }))
    expect((await viewer(request('POST', data), { workspaceId })).status).toBe(403)
  })
  it('refuses a resolved actor from a different workspace', async () => {
    const handler = createLearningHttpHandler('list', dependencies({ async authorize() { return { ...actor, workspaceId: sourceId } } }))
    expect((await handler(request('GET'), { workspaceId })).status).toBe(403)
  })
  it('rejects forged verification and source state fields in registration', async () => {
    const handler = createLearningHttpHandler('register', dependencies())
    const result = await handler(request('POST', { platform: 'instagram', url: 'https://instagram.com/shop',
      consent: { text: true, images: false }, verification: 'verified', ownership: 'owned' }), { workspaceId })
    expect(result.status).toBe(400)
  })
  it('validates revision and candidate decisions instead of passing raw input', async () => {
    const handler = createLearningHttpHandler('review', dependencies())
    expect((await handler(request('POST', { revision: -1, evidenceRevision: 1, decisions: [] }), { workspaceId, sourceId })).status).toBe(400)
    expect((await handler(request('POST', { revision: 1, evidenceRevision: 1,
      decisions: [{ candidateId: sourceId, version: 1, decision: 'approved', confidence: 100 }] }), { workspaceId, sourceId })).status).toBe(400)
  })
  it('returns accepted for durable work but not a false completed receipt', async () => {
    const handler = createLearningHttpHandler('collect', dependencies({ async perform() { return { jobId: sourceId, state: 'queued' } } }))
    const result = await handler(request('POST', { revision: 1 }), { workspaceId, sourceId })
    expect(result.status).toBe(202)
    expect(await result.json()).toEqual({ jobId: sourceId, state: 'queued' })
  })
  it('does not expose provider secrets or raw exception messages', async () => {
    const handler = createLearningHttpHandler('list', dependencies({ async perform() { throw new Error('access_token=secret') } }))
    const result = await handler(request('GET'), { workspaceId })
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain('secret')
  })
  it('rejects oversized bodies before JSON processing', async () => {
    const handler = createLearningHttpHandler('register', dependencies())
    expect((await handler(request('POST', { url: 'x'.repeat(70_000) }), { workspaceId })).status).toBe(413)
  })
})
