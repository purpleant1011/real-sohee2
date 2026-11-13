// ANI-1761 AC-3: 구글 로그인 복귀(취소·실패·성공) 안내 — 사장님이 읽는 문구 계약.
import { describe, expect, it } from 'vitest'
import { resolveOAuthReturnNotice } from '../oauth-return'

/** 화면에 그대로 나가는 문구이므로 영문 코드·내부 용어가 새면 계약 위반이다. */
const INTERNAL_TOKEN = /[A-Za-z_]{4,}/

describe('resolveOAuthReturnNotice', () => {
  it('복귀 신호가 없으면 아무 안내도 그리지 않는다', () => {
    expect(resolveOAuthReturnNotice({})).toBeNull()
    expect(resolveOAuthReturnNotice({ next: '/start' })).toBeNull()
  })

  describe('취소 복귀', () => {
    it('access_denied 를 취소로 읽고 계정 변화 없음을 알린다', () => {
      const notice = resolveOAuthReturnNotice({ error: 'access_denied', next: '/start' })

      expect(notice).toMatchObject({ reason: 'cancelled', tone: 'alert' })
      expect(notice?.title).toContain('취소')
      expect(notice?.detail).toContain('아무 변화가 없어요')
    })

    it('취소 다음 행동은 같은 경로로 다시 로그인하는 것이다', () => {
      const notice = resolveOAuthReturnNotice({ oauth: 'cancelled', next: '/start' })

      expect(notice?.action).toEqual({
        label: '다시 로그인하기',
        href: '/login?next=%2Fstart',
      })
    })

    it('취소를 실패로 뭉뚱그리지 않는다', () => {
      const cancelled = resolveOAuthReturnNotice({ oauth: 'cancelled', next: '/app' })
      const failed = resolveOAuthReturnNotice({ oauth: 'failed', next: '/app' })

      expect(cancelled?.title).not.toBe(failed?.title)
      expect(cancelled?.reason).toBe('cancelled')
      expect(failed?.reason).toBe('failed')
    })
  })

  describe('실패 복귀', () => {
    it('세션 교환 실패는 "연결을 마치지 못했다"로, 이메일 대안을 함께 알린다', () => {
      const notice = resolveOAuthReturnNotice({ error: 'exchange_failed', next: '/app' })

      expect(notice).toMatchObject({ reason: 'failed', tone: 'alert' })
      expect(notice?.title).toContain('마치지 못했')
      expect(notice?.detail).toContain('이메일')
      expect(notice?.action?.href).toBe('/login?next=%2Fapp')
    })

    it('콜백 예외는 잠시 후 재시도를 안내한다', () => {
      const notice = resolveOAuthReturnNotice({ error: 'callback_exception', next: '/app' })

      expect(notice?.reason).toBe('failed')
      expect(notice?.detail).toContain('잠시 후')
    })

    it('결과를 알 수 없으면 아는 척하지 않고 "확인하지 못했다"고 말한다', () => {
      const notice = resolveOAuthReturnNotice({ error: 'no_code', next: '/app' })

      expect(notice?.reason).toBe('failed')
      expect(notice?.title).toContain('확인하지 못했')
      // 취소였을 가능성을 감추지 않는다.
      expect(notice?.detail).toContain('취소')
    })

    it('제공자가 오류를 돌려준 경우는 "실패했다"고 단정해도 되는 사실이다', () => {
      const notice = resolveOAuthReturnNotice({ error: 'server_error', next: '/app' })

      expect(notice?.reason).toBe('failed')
      expect(notice?.title).toContain('마치지 못했')
      expect(notice?.action?.label).toBe('다시 시도하기')
    })

    it('아무 결과도 받지 못한 경우와 오류를 받은 경우를 같은 문구로 뭉뚱그리지 않는다', () => {
      const unknown = resolveOAuthReturnNotice({ error: 'no_code', next: '/app' })
      const known = resolveOAuthReturnNotice({ error: 'server_error', next: '/app' })

      expect(unknown?.title).not.toBe(known?.title)
    })
  })

  describe('성공 복귀', () => {
    it('연결 완료를 알린다', () => {
      const notice = resolveOAuthReturnNotice({ oauth: 'connected', next: '/start' })

      expect(notice).toMatchObject({ reason: 'connected', tone: 'success' })
      expect(notice?.title).toContain('구글')
    })

    it('이미 목적지에 도착했으므로 자기 자신을 가리키는 링크를 만들지 않는다', () => {
      expect(resolveOAuthReturnNotice({ oauth: 'connected', next: '/start' })?.action).toBeNull()
    })
  })

  it('모든 안내 문구에 영문 코드나 내부 용어를 노출하지 않는다', () => {
    const signals = [
      'cancelled',
      'access_denied',
      'failed',
      'exchange_failed',
      'callback_exception',
      'callback',
      'no_code',
      'server_error',
      'connected',
    ] as const

    for (const signal of signals) {
      const notice = resolveOAuthReturnNotice({ oauth: signal, next: '/app' })
      expect(notice, signal).not.toBeNull()
      const visible = `${notice?.title} ${notice?.detail} ${notice?.action?.label ?? ''}`
      expect(visible, signal).not.toMatch(INTERNAL_TOKEN)
    }
  })
  it('카카오로 로그인해 돌아오면 구글이 아닌 카카오 계정으로 로그인했다고 안내한다', () => {
    const notice = resolveOAuthReturnNotice({ oauth: 'connected', next: '/start', provider: 'kakao' })
    expect(notice?.title).toBe('카카오 계정으로 로그인했어요')
    expect(notice?.title).not.toContain('구글')
  })

  it('제공자를 지정하지 않으면 기존대로 구글 계정 로그인 안내를 유지한다', () => {
    expect(resolveOAuthReturnNotice({ oauth: 'connected', next: '/start' })?.title).toBe('구글 계정으로 로그인했어요')
  })
  it('카카오 복귀 오류는 구글 문구 없이 카카오 기준으로 안내한다', () => {
    for (const error of ['session_failed', 'token_exchange_failed', 'profile_fetch_failed', 'invalid_state', 'kakao_error']) {
      const notice = resolveOAuthReturnNotice({ error, next: '/app' })
      expect(notice?.title, error).toBe('카카오 로그인을 마치지 못했어요')
      expect(`${notice?.title}${notice?.detail}`, error).not.toContain('구글')
    }
    expect(resolveOAuthReturnNotice({ error: 'kakao_cancelled', next: '/app' })?.reason).toBe('cancelled')
    expect(resolveOAuthReturnNotice({ error: 'account_linking_prohibited', next: '/app' })?.title).toContain('이미 다른 방법으로 가입')
  })
})
