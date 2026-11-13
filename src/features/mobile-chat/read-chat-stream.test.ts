import { describe, expect, it, vi } from 'vitest'
import { readChatStream } from './read-chat-stream'
import { CHAT_SEND_FAILED_NOTICE } from './chat-send'

function response(events: unknown[]) {
  return new Response(events.map(event => JSON.stringify(event)).join('\n'))
}

const started = { type: 'message.started', messageId: 'a1' }
const completed = { type: 'message.completed', messageId: 'a1' }

describe('readChatStream', () => {
  it('시작되지 않은 응답·다른 응답·완료 뒤 델타는 표시하지 않는다', async () => {
    const onText = vi.fn()
    const delta = (messageId: string, text: string) => ({ type: 'message.delta', messageId, delta: text })
    expect(await readChatStream(response([
      delta('a1', '시작 전'), started, delta('a2', '다른 응답'),
      delta('a1', '서버 텍스트'), completed, delta('a1', '완료 후'),
    ]), onText)).toEqual({ ok: true })
    expect(onText.mock.calls).toEqual([['a1', '서버 텍스트']])
  })

  it('응답 본문이나 완료가 없으면 성공이 아니다', async () => {
    expect(await readChatStream(new Response(null), vi.fn()))
      .toEqual({ ok: false, message: CHAT_SEND_FAILED_NOTICE })
    expect(await readChatStream(response([started]), vi.fn()))
      .toEqual({ ok: false, message: CHAT_SEND_FAILED_NOTICE })
  })

  it('서버 실패 문구를 유지한다', async () => {
    expect(await readChatStream(response([
      started, { type: 'message.failed', messageId: 'a1', message: '응답을 완료하지 못했어요.' },
    ]), vi.fn())).toEqual({ ok: false, message: '응답을 완료하지 못했어요.' })
  })

  it('UTF-8을 바이트 단위로 나눠도 누락 없이 복원한다', async () => {
    const bytes = new TextEncoder().encode([
      started, { type: 'message.delta', messageId: 'a1', delta: '한글 응답' }, completed,
    ].map(event => JSON.stringify(event)).join('\n'))
    const onText = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
        controller.close()
      },
    })
    expect(await readChatStream(new Response(body), onText)).toEqual({ ok: true })
    expect(onText).toHaveBeenCalledWith('a1', '한글 응답')
  })
})
