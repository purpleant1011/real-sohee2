import { describe, expect, it, vi } from 'vitest'
import { normalizeSearchRequest, toWorkspaceSearchResult } from './search-schema'

const workspaceA = '11111111-1111-4111-8111-111111111111'
const workspaceB = '22222222-2222-4222-8222-222222222222'
const resourceId = '33333333-3333-4333-8333-333333333333'
const cursor = '44444444-4444-4444-8444-444444444444'

function rawResult(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: workspaceA,
    kind: 'content',
    resourceId,
    title: '  여름\t캠페인\n초안  ',
    status: 'in_review',
    ...overrides,
  }
}

describe('normalizeSearchRequest', () => {
  it('normalizes a safe workspace search request', () => {
    expect(
      normalizeSearchRequest({
        workspaceId: workspaceA,
        query: '  여름\t캠페인\n초안  ',
        cursor,
      }),
    ).toEqual({ workspaceId: workspaceA, query: '여름 캠페인 초안', cursor })
  })

  it('accepts an omitted cursor without adding an undefined key', () => {
    const result = normalizeSearchRequest({ workspaceId: workspaceA, query: '승인 대기' })

    expect(result).toEqual({ workspaceId: workspaceA, query: '승인 대기' })
    expect(Object.keys(result ?? {})).toEqual(['workspaceId', 'query'])
  })

  it.each([
    ['malformed workspace', { workspaceId: 'workspace-a' }],
    ['uppercase workspace', { workspaceId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }],
    ['one-character query', { query: '가' }],
    ['empty query', { query: '  ' }],
    ['oversized query', { query: '가'.repeat(81) }],
    ['URL query', { query: 'https://example.invalid/reset?code=value' }],
    ['secret query', { query: 'token=secret-value' }],
    ['markup query', { query: '<strong>승인</strong>' }],
    ['control query', { query: '승인\u0000대기' }],
    ['non-string query', { query: { text: '승인 대기' } }],
    ['malformed cursor', { cursor: 'next-page' }],
    ['present undefined cursor', { cursor: undefined }],
    ['extra raw query key', { rawSql: 'select secret' }],
  ])('rejects a request with %s', (_label, override) => {
    expect(
      normalizeSearchRequest({ workspaceId: workspaceA, query: '승인 대기', ...override }),
    ).toBeNull()
  })

  it('reads each approved request field once and keeps the first observation', () => {
    const reads = { workspaceId: 0, query: 0, cursor: 0 }
    const input = {
      get workspaceId() {
        reads.workspaceId += 1
        return reads.workspaceId === 1 ? workspaceA : workspaceB
      },
      get query() {
        reads.query += 1
        return reads.query === 1 ? '승인 대기' : 'token=secret-value'
      },
      get cursor() {
        reads.cursor += 1
        return reads.cursor === 1 ? cursor : 'invalid'
      },
    }

    expect(normalizeSearchRequest(input)).toEqual({
      workspaceId: workspaceA,
      query: '승인 대기',
      cursor,
    })
    expect(reads).toEqual({ workspaceId: 1, query: 1, cursor: 1 })
  })

  it('rejects an invalid workspace before observing a later query getter', () => {
    const queryRead = vi.fn(() => '승인 대기')
    const input = {
      workspaceId: 'workspace-a',
      get query() {
        return queryRead()
      },
    }

    expect(normalizeSearchRequest(input)).toBeNull()
    expect(queryRead).not.toHaveBeenCalled()
  })

  it('keeps the normalized query authoritative before a later cursor getter mutates prototypes', () => {
    const originalReplace = String.prototype.replace
    const input = {
      workspaceId: workspaceA,
      query: '승인 대기',
      get cursor() {
        String.prototype.replace = function () {
          throw new Error('later cursor mutation must not alter the earlier query')
        }
        return cursor
      },
    }

    try {
      expect(normalizeSearchRequest(input)).toEqual({
        workspaceId: workspaceA,
        query: '승인 대기',
        cursor,
      })
    } finally {
      String.prototype.replace = originalReplace
    }
  })

  it('keeps the request frozen when a cursor getter replaces Object.freeze', () => {
    const originalFreeze = Object.freeze
    const input = {
      workspaceId: workspaceA,
      query: '승인 대기',
      get cursor() {
        Object.freeze = ((value: object) => value) as typeof Object.freeze
        return cursor
      },
    }

    try {
      const result = normalizeSearchRequest(input)

      expect(Object.isFrozen(result)).toBe(true)
    } finally {
      Object.freeze = originalFreeze
    }
  })

  it('fails closed without throwing for throwing and revoked request proxies', () => {
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

    expect(normalizeSearchRequest(throwing)).toBeNull()
    expect(normalizeSearchRequest(revoked.proxy)).toBeNull()
  })

  it('does not coerce non-record inputs', () => {
    const coercion = vi.fn(() => '[object Object]')
    const values: unknown[] = [null, undefined, [], 'query', 42, Symbol('query'), new String('query')]

    expect(values.map((value) => normalizeSearchRequest(value))).toEqual(
      values.map(() => null),
    )
    expect(normalizeSearchRequest({ toString: coercion })).toBeNull()
    expect(coercion).not.toHaveBeenCalled()
  })

  it('returns fresh deeply frozen requests', () => {
    const first = normalizeSearchRequest({ workspaceId: workspaceA, query: '승인 대기' })
    const second = normalizeSearchRequest({ workspaceId: workspaceA, query: '승인 대기' })

    expect(first).not.toBe(second)
    expect(Object.isFrozen(first)).toBe(true)
    expect(() => {
      ;(first as { query: string }).query = '오염'
    }).toThrow()
    expect(second?.query).toBe('승인 대기')
  })
})

describe('toWorkspaceSearchResult', () => {
  it.each([
    ['menu', 'work', 'available', '바로가기', '/app/work'],
    ['content', resourceId, 'in_review', '승인 대기', `/app/work/${resourceId}`],
    ['schedule', resourceId, 'scheduled', '예약됨', `/app/schedule?item=${resourceId}`],
    [
      'notification',
      resourceId,
      'unread',
      '읽지 않음',
      `/app/notifications?item=${resourceId}`,
    ],
    [
      'knowledge',
      resourceId,
      'review_required',
      '검토 필요',
      `/app/account/knowledge?item=${resourceId}`,
    ],
    [
      'automation',
      resourceId,
      'active',
      '활성',
      `/app/account/automation?item=${resourceId}`,
    ],
  ] as const)(
    'maps %s to a Korean status and its exact internal detail path',
    (kind, id, status, statusLabel, href) => {
      expect(
        toWorkspaceSearchResult(workspaceA, rawResult({ kind, resourceId: id, status })),
      ).toEqual({
        workspaceId: workspaceA,
        kind,
        resourceId: id,
        title: '여름 캠페인 초안',
        statusLabel,
        href,
      })
    },
  )

  it.each([
    ['home', '/app'],
    ['work', '/app/work'],
    ['schedule', '/app/schedule'],
    ['reports', '/app/reports'],
    ['account', '/app/account'],
    ['notifications', '/app/notifications'],
  ] as const)('allows the approved %s menu route', (resourceId, href) => {
    expect(
      toWorkspaceSearchResult(
        workspaceA,
        rawResult({ kind: 'menu', resourceId, status: 'available' }),
      )?.href,
    ).toBe(href)
  })

  it('drops a result from another workspace before exposing its title', () => {
    const otherWorkspaceTitle = '다른 작업공간의 고유 제목 8302'
    const titleRead = vi.fn(() => otherWorkspaceTitle)
    const result = toWorkspaceSearchResult(workspaceA, {
      workspaceId: workspaceB,
      kind: 'content',
      resourceId,
      get title() {
        return titleRead()
      },
      status: 'in_review',
    })

    expect(result).toBeNull()
    expect(JSON.stringify(result)).not.toContain(otherWorkspaceTitle)
    expect(titleRead).not.toHaveBeenCalled()
  })

  it('maps an unknown raw status to a conservative Korean label', () => {
    const result = toWorkspaceSearchResult(
      workspaceA,
      rawResult({ status: 'unexpected_internal_state' }),
    )

    expect(result?.statusLabel).toBe('상태 확인 필요')
    expect(JSON.stringify(result)).not.toContain('unexpected_internal_state')
  })

  it('replaces an unsafe title without exposing its value', () => {
    const secret = 'ab12'.repeat(8)
    const result = toWorkspaceSearchResult(
      workspaceA,
      rawResult({ title: `token=${secret}` }),
    )

    expect(result?.title).toBe('관련 항목')
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  it.each([
    ['invalid expected workspace', 'workspace-a', rawResult()],
    ['unsupported kind', workspaceA, rawResult({ kind: 'profile' })],
    ['malformed result workspace', workspaceA, rawResult({ workspaceId: 'workspace-a' })],
    ['malformed UUID resource', workspaceA, rawResult({ resourceId: 'content-a' })],
    [
      'unapproved menu key',
      workspaceA,
      rawResult({ kind: 'menu', resourceId: 'admin', status: 'available' }),
    ],
    ['non-string title', workspaceA, rawResult({ title: { text: '제목' } })],
    ['non-string status', workspaceA, rawResult({ status: 1 })],
    ['extra raw body', workspaceA, rawResult({ rawBody: 'must not be observed' })],
  ])('fails closed for %s', (_label, expectedWorkspaceId, result) => {
    expect(toWorkspaceSearchResult(expectedWorkspaceId, result)).toBeNull()
  })

  it('reads each approved result field once and keeps the first observation', () => {
    const reads = { workspaceId: 0, kind: 0, resourceId: 0, title: 0, status: 0 }
    const result = {
      get workspaceId() {
        reads.workspaceId += 1
        return reads.workspaceId === 1 ? workspaceA : workspaceB
      },
      get kind() {
        reads.kind += 1
        return reads.kind === 1 ? 'content' : 'knowledge'
      },
      get resourceId() {
        reads.resourceId += 1
        return reads.resourceId === 1 ? resourceId : 'invalid'
      },
      get title() {
        reads.title += 1
        return reads.title === 1 ? '첫 제목' : 'token=secret-value'
      },
      get status() {
        reads.status += 1
        return reads.status === 1 ? 'in_review' : 'published'
      },
    }

    expect(toWorkspaceSearchResult(workspaceA, result)).toEqual({
      workspaceId: workspaceA,
      kind: 'content',
      resourceId,
      title: '첫 제목',
      statusLabel: '승인 대기',
      href: `/app/work/${resourceId}`,
    })
    expect(reads).toEqual({ workspaceId: 1, kind: 1, resourceId: 1, title: 1, status: 1 })
  })

  it('does not let a resource ID getter poison UUID validation', () => {
    const originalTest = RegExp.prototype.test
    const input = {
      workspaceId: workspaceA,
      kind: 'content',
      get resourceId() {
        RegExp.prototype.test = () => true
        return 'not-a-uuid'
      },
      title: '안전한 제목',
      status: 'in_review',
    }

    try {
      expect(toWorkspaceSearchResult(workspaceA, input)).toBeNull()
    } finally {
      RegExp.prototype.test = originalTest
    }
  })

  it('keeps a safe title authoritative before a later status getter mutates prototypes', () => {
    const originalReplace = String.prototype.replace
    const input = {
      workspaceId: workspaceA,
      kind: 'content',
      resourceId,
      title: '첫 안전 제목',
      get status() {
        String.prototype.replace = function () {
          throw new Error('later status mutation must not alter the earlier title')
        }
        return 'in_review'
      },
    }

    try {
      expect(toWorkspaceSearchResult(workspaceA, input)?.title).toBe('첫 안전 제목')
    } finally {
      String.prototype.replace = originalReplace
    }
  })

  it.each(['identity', 'throw'] as const)(
    'keeps a result frozen and non-throwing when a status getter installs an Object.freeze %s',
    (behavior) => {
      const originalFreeze = Object.freeze
      const input = {
        workspaceId: workspaceA,
        kind: 'content',
        resourceId,
        title: '첫 안전 제목',
        get status() {
          Object.freeze = (
            behavior === 'identity'
              ? ((value: object) => value)
              : (() => {
                  throw new Error('live Object.freeze must not be called')
                })
          ) as typeof Object.freeze
          return 'in_review'
        },
      }

      try {
        const result = toWorkspaceSearchResult(workspaceA, input)

        expect(result).toMatchObject({ statusLabel: '승인 대기' })
        expect(Object.isFrozen(result)).toBe(true)
      } finally {
        Object.freeze = originalFreeze
      }
    },
  )

  it('fails closed without throwing for throwing and revoked result proxies', () => {
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

    expect(toWorkspaceSearchResult(workspaceA, throwing)).toBeNull()
    expect(toWorkspaceSearchResult(workspaceA, revoked.proxy)).toBeNull()
  })

  it('returns fresh frozen search results', () => {
    const first = toWorkspaceSearchResult(workspaceA, rawResult())
    const second = toWorkspaceSearchResult(workspaceA, rawResult())

    expect(first).not.toBe(second)
    expect(Object.isFrozen(first)).toBe(true)
    expect(() => {
      ;(first as { title: string }).title = '오염'
    }).toThrow()
    expect(second?.title).toBe('여름 캠페인 초안')
  })

  it('uses no network, Supabase, time, randomness, or global crypto', () => {
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

    expect(toWorkspaceSearchResult(workspaceA, rawResult())).not.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(dateNowSpy).not.toHaveBeenCalled()
    expect(randomSpy).not.toHaveBeenCalled()
    expect(cryptoGetSpy).not.toHaveBeenCalled()
  })
})
