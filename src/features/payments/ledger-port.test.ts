import { describe, expect, it } from 'vitest'
import {
  LedgerPortError,
  assertPositiveSafeInteger,
  assertValidDate,
  assertWorkspaceId,
  isLedgerUuid,
} from './ledger-port'

const WS = '11111111-1111-4111-8111-111111111111'

function codeOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(LedgerPortError)
    return (error as LedgerPortError).code
  }
  throw new Error('expected a throw')
}

describe('ledger port 공용 가드', () => {
  it('UUID 형식만 workspace로 받는다', () => {
    expect(assertWorkspaceId(WS)).toBe(WS)
    expect(isLedgerUuid(WS)).toBe(true)
    expect(isLedgerUuid('ws-a')).toBe(false)
    expect(isLedgerUuid(undefined)).toBe(false)
    expect(codeOf(() => assertWorkspaceId('ws-a'))).toBe('INVALID_LEDGER_INPUT')
    expect(codeOf(() => assertWorkspaceId(42))).toBe('INVALID_LEDGER_INPUT')
  })

  it('금액은 양의 안전 정수만 받는다', () => {
    expect(assertPositiveSafeInteger(1, 'amountKrw')).toBe(1)
    for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, '1000', null]) {
      expect(codeOf(() => assertPositiveSafeInteger(bad, 'amountKrw'))).toBe('INVALID_LEDGER_INPUT')
    }
  })

  it('now는 유효한 Date만 받는다', () => {
    const now = new Date('2026-10-22T09:00:00Z')
    expect(assertValidDate(now, 'now')).toBe(now)
    expect(codeOf(() => assertValidDate('2026-10-22T09:00:00Z', 'now'))).toBe('INVALID_LEDGER_INPUT')
    expect(codeOf(() => assertValidDate(new Date(Number.NaN), 'now'))).toBe('INVALID_LEDGER_INPUT')
  })

  it('오류 코드는 메시지 앞머리에 그대로 남는다', () => {
    const error = new LedgerPortError('LEDGER_UNAVAILABLE', 'rpc down')
    expect(error.code).toBe('LEDGER_UNAVAILABLE')
    expect(error.message).toBe('LEDGER_UNAVAILABLE:rpc down')
    expect(error).toBeInstanceOf(Error)
  })
})
