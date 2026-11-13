import { describe, expect, it, vi } from 'vitest'
import { buildChatContext } from './chat-context'

const resourceId = '11111111-1111-4111-8111-111111111111'

function validResource() {
  return {
    kind: 'content',
    id: resourceId,
    title: '  여름 캠페인\t초안  ',
    statusLabel: ' 승인\n대기 ',
    summary: ' Instagram과 Threads 문구를 검토해 주세요. ',
  }
}

describe('buildChatContext', () => {
  it('keeps only a safe app route and normalized selected-resource summary', () => {
    expect(buildChatContext('/app/work', validResource())).toEqual({
      route: '/app/work',
      selectedResource: {
        kind: 'content',
        id: resourceId,
        title: '여름 캠페인 초안',
        statusLabel: '승인 대기',
        summary: 'Instagram과 Threads 문구를 검토해 주세요.',
      },
    })
  })

  it.each([
    '/login',
    '/application',
    '/app/work?token=secret-value',
    '/app/work#secret',
    '/app/token=secret-value',
    '/app/%3ftoken%3dsecret-value',
    '/app/%23secret-value',
    '/app/../admin',
    '/app\\admin',
    '/app/%2e%2e/admin',
    '/app/work\u0000',
    `/${'a'.repeat(260)}`,
  ])('falls back to /app for an unsafe route %j', (route) => {
    expect(buildChatContext(route, null).route).toBe('/app')
  })

  it.each([null, undefined, 42, true, Symbol('route'), new String('/app/work')])(
    'does not coerce a non-primitive route',
    (route) => {
      expect(buildChatContext(route, null).route).toBe('/app')
    },
  )

  it.each(['content', 'schedule', 'notification', 'knowledge', 'automation'] as const)(
    'accepts the approved %s selected-resource kind',
    (kind) => {
      const result = buildChatContext('/app', { ...validResource(), kind })

      expect(result.selectedResource?.kind).toBe(kind)
    },
  )

  it('replaces unsafe resource text without exposing secret, URL, or markup values', () => {
    const secret = 'ab12'.repeat(8)
    const result = buildChatContext('/app', {
      ...validResource(),
      title: '<strong>초안</strong>',
      statusLabel: 'token=secret-value',
      summary: `https://example.invalid/reset?code=${secret}`,
    })
    const serialized = JSON.stringify(result)

    expect(result.selectedResource).toEqual({
      kind: 'content',
      id: resourceId,
      title: '선택한 자료',
      statusLabel: '상태 확인 필요',
      summary: '선택한 자료의 세부 내용은 관련 화면에서 확인해 주세요.',
    })
    expect(serialized).not.toContain('strong')
    expect(serialized).not.toContain('secret-value')
    expect(serialized).not.toContain(secret)
  })

  it.each([
    'pending',
    'READY',
    '123',
    '準備中',
    '✅',
    'pending 승인 대기',
    '알 수 없는 임의 상태',
  ])(
    'replaces an unapproved resource status %j with a conservative Korean label',
    (statusLabel) => {
      const result = buildChatContext('/app/work', {
        ...validResource(),
        statusLabel,
      })

      expect(result.selectedResource?.statusLabel).toBe('상태 확인 필요')
      expect(JSON.stringify(result)).not.toContain(statusLabel)
    },
  )

  it.each([
    ['unsupported kind', { kind: 'profile' }],
    ['malformed UUID', { id: 'content-1' }],
    ['missing title', { title: undefined }],
    ['non-string status', { statusLabel: 1 }],
    ['non-string summary', { summary: { text: 'safe' } }],
    ['extra raw content', { rawContent: 'must never be observed' }],
  ])('omits a selected resource with %s', (_label, override) => {
    expect(
      buildChatContext('/app/work', { ...validResource(), ...override }).selectedResource,
    ).toBeNull()
  })

  it('accepts an omitted summary without adding an undefined key', () => {
    const resource = {
      kind: 'content',
      id: resourceId,
      title: '  여름 캠페인\t초안  ',
      statusLabel: ' 승인\n대기 ',
    }
    const selectedResource = buildChatContext('/app', resource).selectedResource

    expect(selectedResource).toEqual({
      kind: 'content',
      id: resourceId,
      title: '여름 캠페인 초안',
      statusLabel: '승인 대기',
    })
    expect(Object.keys(selectedResource ?? {})).toEqual([
      'kind',
      'id',
      'title',
      'statusLabel',
    ])
  })

  it('reads each selected-resource field once and keeps the first observation', () => {
    const reads = { kind: 0, id: 0, title: 0, statusLabel: 0, summary: 0 }
    const resource = {
      get kind() {
        reads.kind += 1
        return reads.kind === 1 ? 'content' : 'automation'
      },
      get id() {
        reads.id += 1
        return reads.id === 1 ? resourceId : 'not-a-uuid'
      },
      get title() {
        reads.title += 1
        return reads.title === 1 ? '첫 제목' : 'token=secret-value'
      },
      get statusLabel() {
        reads.statusLabel += 1
        return reads.statusLabel === 1 ? '승인 대기' : '<unsafe>'
      },
      get summary() {
        reads.summary += 1
        return reads.summary === 1 ? '첫 안전 요약' : 'https://example.invalid'
      },
    }

    expect(buildChatContext('/app/work', resource).selectedResource).toEqual({
      kind: 'content',
      id: resourceId,
      title: '첫 제목',
      statusLabel: '승인 대기',
      summary: '첫 안전 요약',
    })
    expect(reads).toEqual({ kind: 1, id: 1, title: 1, statusLabel: 1, summary: 1 })
  })

  it('fails closed without throwing for throwing and revoked selected-resource proxies', () => {
    const throwing = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('must fail closed')
        },
      },
    )
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()

    expect(buildChatContext('/app', throwing).selectedResource).toBeNull()
    expect(buildChatContext('/app', revoked.proxy).selectedResource).toBeNull()
  })

  it('returns fresh deeply frozen results that callers cannot poison', () => {
    const first = buildChatContext('/app/work', validResource())
    const second = buildChatContext('/app/work', validResource())

    expect(first).not.toBe(second)
    expect(first.selectedResource).not.toBe(second.selectedResource)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.selectedResource)).toBe(true)
    expect(() => {
      ;(first as { route: string }).route = '/app/account'
    }).toThrow()
    expect(() => {
      ;(first.selectedResource as { title: string }).title = '오염'
    }).toThrow()
    expect(second.route).toBe('/app/work')
    expect(second.selectedResource?.title).toBe('여름 캠페인 초안')
  })

  it('does not use network, time, randomness, or global crypto', () => {
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
      throw new Error('crypto must not be read')
    })
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('crypto', new Proxy({}, { get: cryptoGetSpy }))

    expect(buildChatContext('/app/work', validResource()).selectedResource).not.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(dateNowSpy).not.toHaveBeenCalled()
    expect(randomSpy).not.toHaveBeenCalled()
    expect(cryptoGetSpy).not.toHaveBeenCalled()
  })
})
