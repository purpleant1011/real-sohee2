import { describe, expect, it } from 'vitest'
import { parseConnectFlow } from './channels-connect'

describe('모바일 Meta 연결 오류 계약', () => {
  it('콜백의 안전한 실패 코드를 유지한다', () => {
    expect(parseConnectFlow('?connect=unavailable&connect_error=SCOPE_MISSING&channel=instagram')).toEqual({ result: 'unavailable', channel: 'instagram', safeCode: 'SCOPE_MISSING' })
    expect(parseConnectFlow('?error=ACCOUNT_ALREADY_CONNECTED&channel=threads')).toEqual({ result: 'unavailable', channel: 'threads', safeCode: 'ACCOUNT_ALREADY_CONNECTED' })
  })
  it('알 수 없는 오류 설명이나 비정상 채널은 신뢰하지 않는다', () => {
    expect(parseConnectFlow('?connect=unavailable&connect_error=secret-token&error_description=private&channel=evil')).toEqual({ result: 'unavailable', channel: null })
    expect(parseConnectFlow('?error=secret-token')).toBeNull()
  })
})
