// ANI-1673 (M02): OAuth 취소/복귀 시 입력 보존과 안전한 next.
import { describe, expect, it } from 'vitest'
import { resolveAuthReturn } from '../auth-return'

describe('resolveAuthReturn', () => {
  it('외부 URL·프로토콜 상대 경로는 /start 로 정규화', () => {
    expect(resolveAuthReturn({ next: 'https://evil.example' }).path).toBe('/app')
    expect(resolveAuthReturn({ next: '//evil.example' }).path).toBe('/app')
  })
  it('유효한 /start 는 유지', () => {
    expect(resolveAuthReturn({ next: '/start' }).path).toBe('/start')
  })
  it('OAuth 취소(error=access_denied)는 입력 보존 + 다시 시도 안내', () => {
    expect(resolveAuthReturn({ next: '/start', error: 'access_denied' })).toMatchObject({
      path: '/start',
      preserveDraft: true,
      message: expect.stringContaining('다시'),
    })
  })
  it('안내 문구에 영문 코드나 내부 용어를 노출하지 않는다', () => {
    const m = resolveAuthReturn({ next: '/start', error: 'server_error' }).message ?? ''
    expect(m).not.toMatch(/[A-Za-z_]{6,}/)
  })
})
