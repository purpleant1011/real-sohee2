import { describe, expect, it } from 'vitest'
import { classifyPublishFailure } from './failure-classifier'

const permanentFailure = {
  code: 'PUBLISH_PERMANENT_FAILURE',
  retryable: false,
  action: '고객 지원 문의',
} as const

describe('classifyPublishFailure', () => {
  it.each([
    [
      'TEMPORARY_NETWORK',
      { code: 'PUBLISH_RETRYABLE', retryable: true, action: '다시 시도' },
    ],
    [
      'RATE_LIMITED',
      { code: 'PUBLISH_RETRYABLE', retryable: true, action: '다시 시도' },
    ],
    [
      'RECONCILED_NO_POST',
      { code: 'PUBLISH_RETRYABLE', retryable: true, action: '다시 시도' },
    ],
    [
      'TOKEN_EXPIRED',
      {
        code: 'PUBLISH_RECONNECT_REQUIRED',
        retryable: false,
        action: '채널 다시 연결',
      },
    ],
    [
      'APPROVAL_STALE',
      {
        code: 'PUBLISH_REAPPROVAL_REQUIRED',
        retryable: false,
        action: '다시 승인',
      },
    ],
    ['PROVIDER_REJECTED', permanentFailure],
  ] as const)('maps %s to the exact recovery contract', (rawCode, expected) => {
    const result = classifyPublishFailure(rawCode)

    expect(result).toEqual(expected)
    expect(Object.keys(result)).toEqual(['code', 'retryable', 'action'])
  })

  it('conservatively classifies every unknown runtime value without coercion or exceptions', () => {
    const coercionTrap = {
      toString() {
        throw new Error('must not coerce to string')
      },
      valueOf() {
        throw new Error('must not coerce to primitive')
      },
      [Symbol.toPrimitive]() {
        throw new Error('must not coerce through Symbol.toPrimitive')
      },
    }
    const revocable = Proxy.revocable({}, {})
    revocable.revoke()
    const unknownValues: unknown[] = [
      'temporary_network',
      'UNKNOWN_PROVIDER_CODE',
      '',
      null,
      undefined,
      0,
      Number.NaN,
      false,
      {},
      Symbol('provider-code'),
      coercionTrap,
      revocable.proxy,
    ]

    for (const value of unknownValues) {
      let result: ReturnType<typeof classifyPublishFailure> | undefined

      expect(() => {
        result = classifyPublishFailure(value)
      }).not.toThrow()
      expect(result).toEqual(permanentFailure)
    }
  })

  it('returns a fresh frozen result that one caller cannot poison', () => {
    const first = classifyPublishFailure('TEMPORARY_NETWORK')
    const second = classifyPublishFailure('TEMPORARY_NETWORK')

    expect(first).not.toBe(second)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(second)).toBe(true)
    expect(() => {
      ;(first as { action: string }).action = 'poisoned'
    }).toThrow()
    expect(second).toEqual({
      code: 'PUBLISH_RETRYABLE',
      retryable: true,
      action: '다시 시도',
    })
  })
})
