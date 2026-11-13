import { describe, expect, it } from 'vitest'
import { CONNECTOR_CATALOG } from './catalog'
import { isValidDisconnectReceipt } from './disconnect-receipt'

const IDS = CONNECTOR_CATALOG.map((c) => c.id)
const base = (connectorId: unknown) => ({ ok: true, connectorId, pendingDeletion: false, consentGeneration: 1 })

describe('isValidDisconnectReceipt', () => {
  it('알려진 커넥터가 11개다', () => {
    expect(IDS).toHaveLength(11)
  })

  it('11x11 요청/응답 행렬에서 대각선만 허용한다 (alias 없음)', () => {
    for (const expected of IDS) {
      for (const actual of IDS) {
        expect(isValidDisconnectReceipt(base(actual), expected), `${expected} <- ${actual}`).toBe(expected === actual)
      }
    }
  })

  it('google_calendar 영수증을 apple_calendar 요청에 허용하지 않는다', () => {
    expect(isValidDisconnectReceipt(base('google_calendar'), 'apple_calendar')).toBe(false)
  })

  it('알 수 없는 ID는 요청과 같아도 거부한다', () => {
    expect(isValidDisconnectReceipt(base('unknown_x'), 'unknown_x' as never)).toBe(false)
  })

  it.each([
    ['ok 누락', { connectorId: 'gmail', pendingDeletion: true, consentGeneration: 1 }],
    ['ok false', { ...base('gmail'), ok: false }],
    ['ok 문자열', { ...base('gmail'), ok: 'true' }],
    ['pendingDeletion 누락', { ok: true, connectorId: 'gmail', consentGeneration: 1 }],
    ['pendingDeletion 문자열', { ...base('gmail'), pendingDeletion: 'false' }],
    ['generation 0', { ...base('gmail'), consentGeneration: 0 }],
    ['generation 음수', { ...base('gmail'), consentGeneration: -1 }],
    ['generation 분수', { ...base('gmail'), consentGeneration: 1.5 }],
    ['generation NaN', { ...base('gmail'), consentGeneration: NaN }],
    ['generation Infinity', { ...base('gmail'), consentGeneration: Infinity }],
    ['generation unsafe', { ...base('gmail'), consentGeneration: Number.MAX_SAFE_INTEGER + 2 }],
    ['generation 문자열', { ...base('gmail'), consentGeneration: '1' }],
    ['null', null],
    ['배열', []],
    ['문자열', 'ok'],
  ])('%s 거부', (_name, receipt) => {
    expect(isValidDisconnectReceipt(receipt, 'gmail')).toBe(false)
  })

  it('정상 영수증(pendingDeletion true/false, 큰 safe integer) 허용', () => {
    expect(isValidDisconnectReceipt({ ...base('gmail'), pendingDeletion: true }, 'gmail')).toBe(true)
    expect(isValidDisconnectReceipt({ ...base('gmail'), consentGeneration: Number.MAX_SAFE_INTEGER }, 'gmail')).toBe(true)
  })
})
