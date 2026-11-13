import { describe, expect, it } from 'vitest'

import {
  CHAT_SEND_FAILED_NOTICE,
  chatSendResultFromResponse,
  failedSendNotice,
  isFailedSendResult,
} from './chat-send'

describe('isFailedSendResult', () => {
  it('ok=false 이고 사용자 문구가 있으면 실패로 본다', () => {
    expect(isFailedSendResult({ ok: false, message: '전송 실패' })).toBe(true)
  })

  it('성공 결과는 실패가 아니다', () => {
    expect(isFailedSendResult({ ok: true })).toBe(false)
  })

  it('문구가 없거나 공백이면 실패로 인정하지 않는다', () => {
    expect(isFailedSendResult({ ok: false })).toBe(false)
    expect(isFailedSendResult({ ok: false, message: '' })).toBe(false)
    expect(isFailedSendResult({ ok: false, message: '   ' })).toBe(false)
    expect(isFailedSendResult({ ok: false, message: 500 })).toBe(false)
  })

  it('객체가 아닌 값은 실패가 아니다', () => {
    expect(isFailedSendResult(null)).toBe(false)
    expect(isFailedSendResult(undefined)).toBe(false)
    expect(isFailedSendResult('실패')).toBe(false)
    expect(isFailedSendResult([])).toBe(false)
  })
})

describe('failedSendNotice', () => {
  it('실패 문구를 그대로 돌려준다', () => {
    expect(failedSendNotice({ ok: false, message: '잠시 뒤 다시 시도해 주세요' })).toBe(
      '잠시 뒤 다시 시도해 주세요',
    )
  })

  it('실패가 아니면 null 이다', () => {
    expect(failedSendNotice({ ok: true })).toBeNull()
    expect(failedSendNotice({ ok: false, message: ' ' })).toBeNull()
    expect(failedSendNotice(null)).toBeNull()
  })

  it('기본 실패 문구는 사용자에게 보여줄 수 있는 한국어다', () => {
    expect(CHAT_SEND_FAILED_NOTICE).toContain('다시 시도')
  })
})

describe('chatSendResultFromResponse', () => {
  it('2xx 정상 본문은 성공이다', () => {
    expect(
      chatSendResultFromResponse({
        status: 200,
        body: { role: 'assistant', content: '초안을 만들었어요.' },
      }),
    ).toEqual({ ok: true })
  })

  it('500 실패 본문은 서버의 사용자 문구로 실패 처리한다', () => {
    expect(
      chatSendResultFromResponse({
        status: 500,
        body: {
          role: 'assistant',
          step: 'ERROR',
          status: 'FAILED',
          errorCode: 'AGENT_CHAT_TURN_FAILED',
          content: '잠시 후 다시 시도해 주세요.',
        },
      }),
    ).toEqual({ ok: false, message: '잠시 후 다시 시도해 주세요.' })
  })

  it('400 실패 본문도 실패다', () => {
    expect(
      chatSendResultFromResponse({
        status: 400,
        body: {
          status: 'FAILED',
          errorCode: 'EMPTY_CURRENT_USER_MESSAGE',
          content: '메시지 내용을 입력해 주세요.',
        },
      }),
    ).toEqual({ ok: false, message: '메시지 내용을 입력해 주세요.' })
  })

  it('2xx 라도 서버 실패 표시가 있으면 성공으로 치지 않는다', () => {
    expect(
      chatSendResultFromResponse({
        status: 200,
        body: { status: 'FAILED', content: '저장하지 못했어요.' },
      }),
    ).toEqual({ ok: false, message: '저장하지 못했어요.' })

    expect(
      chatSendResultFromResponse({
        status: 200,
        body: { step: 'ERROR' },
      }),
    ).toEqual({ ok: false, message: CHAT_SEND_FAILED_NOTICE })

    expect(
      chatSendResultFromResponse({
        status: 200,
        body: { errorCode: 'PERSISTENCE_FAILED' },
      }),
    ).toEqual({ ok: false, message: CHAT_SEND_FAILED_NOTICE })
  })

  it('본문을 읽지 못하면 2xx 여도 실패다', () => {
    expect(chatSendResultFromResponse({ status: 200, body: null })).toEqual({
      ok: false,
      message: CHAT_SEND_FAILED_NOTICE,
    })
    expect(chatSendResultFromResponse({ status: 200, body: [] })).toEqual({
      ok: false,
      message: CHAT_SEND_FAILED_NOTICE,
    })
    expect(chatSendResultFromResponse({ status: 200, body: 'ok' })).toEqual({
      ok: false,
      message: CHAT_SEND_FAILED_NOTICE,
    })
  })

  it('명시적 실패 계약은 그 문구를 그대로 쓴다', () => {
    expect(
      chatSendResultFromResponse({
        status: 200,
        body: { ok: false, message: '잠시 뒤 다시 시도해 주세요.' },
      }),
    ).toEqual({ ok: false, message: '잠시 뒤 다시 시도해 주세요.' })
  })

  it('상태 코드가 숫자가 아니면 실패다', () => {
    expect(
      chatSendResultFromResponse({ status: Number.NaN, body: { content: 'x' } }),
    ).toEqual({ ok: false, message: 'x' })
  })

  it('401 인증 실패 응답의 message 로그인 안내를 그대로 보여준다', () => {
    expect(
      chatSendResultFromResponse({
        status: 401,
        body: {
          success: false,
          error: 'UNAUTHORIZED',
          message: '인증이 필요합니다. 로그인 후 다시 시도해 주세요.',
        },
      }),
    ).toEqual({
      ok: false,
      message: '인증이 필요합니다. 로그인 후 다시 시도해 주세요.',
    })
  })

  it('403 권한 실패 응답의 message 안내를 그대로 보여준다', () => {
    expect(
      chatSendResultFromResponse({
        status: 403,
        body: {
          success: false,
          error: 'FORBIDDEN',
          message: '해당 작업공간에 대한 접근 권한이 없습니다.',
        },
      }),
    ).toEqual({
      ok: false,
      message: '해당 작업공간에 대한 접근 권한이 없습니다.',
    })
  })

  it('인증 실패 응답의 message 가 공백이면 기본 문구로 닫는다', () => {
    expect(
      chatSendResultFromResponse({
        status: 401,
        body: { success: false, error: 'UNAUTHORIZED', message: '   ' },
      }),
    ).toEqual({ ok: false, message: CHAT_SEND_FAILED_NOTICE })
  })

  it('실패 문구가 비어 있으면 기본 문구로 닫는다', () => {
    expect(
      chatSendResultFromResponse({
        status: 500,
        body: { status: 'FAILED', content: '   ' },
      }),
    ).toEqual({ ok: false, message: CHAT_SEND_FAILED_NOTICE })
  })
})
