import { describe, expect, it, vi } from 'vitest'
import { deriveReportState } from './report-state'

const checkedAt = new Date('2026-08-09T03:00:00.000Z')

const expectedMessages = {
  sufficient: '관측된 게시물 기준으로 성과를 확인할 수 있어요.',
  limited: '확인된 표본이 적어 성과 원인을 단정하지 않아요.',
  collecting: '자료를 모으고 있어요. 아직 실제 0건으로 계산하지 않아요.',
  unavailable: '리포트 데이터 연결 상태를 확인해 주세요.',
} as const

describe('deriveReportState', () => {
  it.each([
    [
      'a checked positive sample',
      { observedPosts: 3, checkedAt, sourceReady: true },
      'sufficient',
    ],
    [
      'a checked actual zero',
      { observedPosts: 0, checkedAt, sourceReady: true },
      'limited',
    ],
    [
      'a missing check time',
      { observedPosts: 3, checkedAt: null, sourceReady: true },
      'collecting',
    ],
    [
      'an uncollected post count',
      { observedPosts: null, checkedAt, sourceReady: true },
      'collecting',
    ],
    [
      'both uncollected sample fields',
      { observedPosts: null, checkedAt: null, sourceReady: true },
      'collecting',
    ],
  ])('returns %s as %s', (_label, input, expectedKind) => {
    expect(deriveReportState(input)).toEqual({
      kind: expectedKind,
      message: expectedMessages[expectedKind as keyof typeof expectedMessages],
    })
  })

  it.each([
    ['a disconnected source', { observedPosts: 1, checkedAt, sourceReady: false }],
    ['a truthy non-boolean source flag', { observedPosts: 1, checkedAt, sourceReady: 1 }],
    ['a missing source flag', { observedPosts: 1, checkedAt }],
    ['a missing count', { checkedAt, sourceReady: true }],
    ['a missing check time', { observedPosts: 1, sourceReady: true }],
    ['a negative count', { observedPosts: -1, checkedAt, sourceReady: true }],
    ['a fractional count', { observedPosts: 1.5, checkedAt, sourceReady: true }],
    [
      'an unsafe count',
      { observedPosts: Number.MAX_SAFE_INTEGER + 1, checkedAt, sourceReady: true },
    ],
    ['a NaN count', { observedPosts: Number.NaN, checkedAt, sourceReady: true }],
    ['an infinite count', { observedPosts: Number.POSITIVE_INFINITY, checkedAt, sourceReady: true }],
    ['a numeric string count', { observedPosts: '1', checkedAt, sourceReady: true }],
    ['a boxed numeric count', { observedPosts: new Number(1), checkedAt, sourceReady: true }],
    [
      'an invalid Date',
      { observedPosts: 1, checkedAt: new Date(Number.NaN), sourceReady: true },
    ],
    ['an ISO string check time', { observedPosts: 1, checkedAt: checkedAt.toISOString(), sourceReady: true }],
    [
      'a Date-prototype imposter',
      { observedPosts: 1, checkedAt: Object.create(Date.prototype), sourceReady: true },
    ],
    [
      'an invalid count even while the check time is uncollected',
      { observedPosts: -1, checkedAt: null, sourceReady: true },
    ],
    [
      'an invalid Date even while the count is uncollected',
      { observedPosts: null, checkedAt: new Date(Number.NaN), sourceReady: true },
    ],
    ['a null input', null],
    ['an array input', [1, checkedAt, true]],
    ['a primitive input', 'ready'],
  ])('fails closed for %s', (_label, input) => {
    expect(deriveReportState(input)).toEqual({
      kind: 'unavailable',
      message: expectedMessages.unavailable,
    })
  })

  it('reads each report field once and keeps the first observed values authoritative', () => {
    const reads = {
      observedPosts: 0,
      checkedAt: 0,
      sourceReady: 0,
    }
    const input = {
      get observedPosts() {
        reads.observedPosts += 1
        return reads.observedPosts === 1 ? 2 : 0
      },
      get checkedAt() {
        reads.checkedAt += 1
        return reads.checkedAt === 1 ? checkedAt : new Date(Number.NaN)
      },
      get sourceReady() {
        reads.sourceReady += 1
        return reads.sourceReady === 1
      },
    }

    expect(deriveReportState(input)).toEqual({
      kind: 'sufficient',
      message: expectedMessages.sufficient,
    })
    expect(reads).toEqual({ observedPosts: 1, checkedAt: 1, sourceReady: 1 })
  })

  it('keeps an initially invalid checkedAt unavailable when a later getter makes the same Date valid', () => {
    const mutableCheckedAt = new Date(Number.NaN)
    const reads = {
      observedPosts: 0,
      checkedAt: 0,
      sourceReady: 0,
    }
    const input = {
      get observedPosts() {
        reads.observedPosts += 1
        return 2
      },
      get checkedAt() {
        reads.checkedAt += 1
        return mutableCheckedAt
      },
      get sourceReady() {
        reads.sourceReady += 1
        mutableCheckedAt.setTime(checkedAt.getTime())
        return true
      },
    }

    expect(deriveReportState(input)).toEqual({
      kind: 'unavailable',
      message: expectedMessages.unavailable,
    })
    expect(reads).toEqual({ observedPosts: 1, checkedAt: 1, sourceReady: 1 })
  })

  it('preserves an initially valid checkedAt when a later getter invalidates the same Date', () => {
    const mutableCheckedAt = new Date(checkedAt.getTime())
    const reads = {
      observedPosts: 0,
      checkedAt: 0,
      sourceReady: 0,
    }
    const input = {
      get observedPosts() {
        reads.observedPosts += 1
        return 2
      },
      get checkedAt() {
        reads.checkedAt += 1
        return mutableCheckedAt
      },
      get sourceReady() {
        reads.sourceReady += 1
        mutableCheckedAt.setTime(Number.NaN)
        return true
      },
    }

    expect(deriveReportState(input)).toEqual({
      kind: 'sufficient',
      message: expectedMessages.sufficient,
    })
    expect(reads).toEqual({ observedPosts: 1, checkedAt: 1, sourceReady: 1 })
  })

  it.each(['observedPosts', 'checkedAt', 'sourceReady'] as const)(
    'does not throw or expose details from a throwing %s getter',
    (throwingField) => {
      const input = {
        observedPosts: 2,
        checkedAt,
        sourceReady: true,
      }
      Object.defineProperty(input, throwingField, {
        configurable: true,
        get() {
          throw new Error('PRIVATE_REPORT_EXCEPTION_DETAIL')
        },
      })

      const state = deriveReportState(input)

      expect(state).toEqual({
        kind: 'unavailable',
        message: expectedMessages.unavailable,
      })
      expect(state.message).not.toContain('PRIVATE_REPORT_EXCEPTION_DETAIL')
    },
  )

  it('does not throw for a revoked Proxy input', () => {
    const { proxy, revoke } = Proxy.revocable(
      { observedPosts: 2, checkedAt, sourceReady: true },
      {},
    )
    revoke()

    expect(() => deriveReportState(proxy)).not.toThrow()
    expect(deriveReportState(proxy)).toEqual({
      kind: 'unavailable',
      message: expectedMessages.unavailable,
    })
  })

  it('fails closed when a field disappears during the one-pass snapshot', () => {
    const input: {
      observedPosts: number
      checkedAt?: Date
      sourceReady: boolean
    } = {
      get observedPosts() {
        delete input.checkedAt
        return 2
      },
      checkedAt,
      sourceReady: true,
    }

    expect(deriveReportState(input)).toEqual({
      kind: 'unavailable',
      message: expectedMessages.unavailable,
    })
  })

  it.each([
    [{ observedPosts: 2, checkedAt, sourceReady: true }, 'sufficient'],
    [{ observedPosts: 0, checkedAt, sourceReady: true }, 'limited'],
    [{ observedPosts: null, checkedAt, sourceReady: true }, 'collecting'],
    [{ observedPosts: 2, checkedAt, sourceReady: false }, 'unavailable'],
  ] as const)('returns a fresh frozen exact-shape %s output', (input, expectedKind) => {
    const first = deriveReportState(input)
    const second = deriveReportState(input)

    expect(first).not.toBe(second)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.keys(first)).toEqual(['kind', 'message'])
    expect(first.kind).toBe(expectedKind)
    expect(() => Object.defineProperty(first, 'kind', { value: '__poisoned__' })).toThrow()
    expect(second.kind).toBe(expectedKind)
  })

  it('does not mutate a frozen report input or call ambient runtime APIs', () => {
    const input = Object.freeze({ observedPosts: 2, checkedAt, sourceReady: true })
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now must not be called')
    })
    const mathRandom = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be called')
    })
    const fetchSpy = vi.fn(() => {
      throw new Error('fetch must not be called')
    })
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal(
      'crypto',
      new Proxy(
        {},
        {
          get() {
            throw new Error('crypto must not be read')
          },
        },
      ),
    )

    try {
      expect(deriveReportState(input)).toEqual({
        kind: 'sufficient',
        message: expectedMessages.sufficient,
      })
      expect(input).toEqual({ observedPosts: 2, checkedAt, sourceReady: true })
      expect(dateNow).not.toHaveBeenCalled()
      expect(mathRandom).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      dateNow.mockRestore()
      mathRandom.mockRestore()
    }
  })
})
