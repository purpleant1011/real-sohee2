import { describe, expect, it } from 'vitest'

import { CHAT_SEND_FAILED_NOTICE } from './chat-send'
import {
  CHAT_MESSAGE_LIMIT,
  emptyChatSnapshot,
  failedChatSnapshot,
  failedOrStaleChatSnapshot,
  latestThreadId,
  sendOutcomeFromStream,
  startedThreadId,
  toChatSnapshot,
  unauthorizedChatSnapshot,
} from './r2-chat-snapshot'

const CHECKED_AT = '2026-10-24T01:00:00.000Z'

function messagesPayload(rows: unknown[]) {
  return { data: rows }
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    role: 'sohee',
    content: '초안을 준비했어요.',
    status: 'completed',
    evidenceRefs: [],
    ...overrides,
  }
}

describe('latestThreadId — 목록 응답 판정', () => {
  it('최신순 첫 대화를 고른다', () => {
    expect(latestThreadId({ data: { items: [{ id: 't2' }, { id: 't1' }], hasMore: false } }))
      .toEqual({ ok: true, threadId: 't2' })
  })

  it('빈 목록은 정말 대화가 없는 상태다', () => {
    expect(latestThreadId({ data: { items: [], hasMore: false } })).toEqual({ ok: true, threadId: null })
  })

  it.each([
    [null],
    [{}],
    [{ data: {} }],
    [{ data: { items: 'nope' } }],
    [{ data: { items: [{}] } }],
    [{ data: { items: [{ id: '   ' }] } }],
  ])('계약과 다른 모양(%o)은 조회 실패로 닫는다', payload => {
    expect(latestThreadId(payload)).toEqual({ ok: false })
  })
})

describe('startedThreadId — 새 대화 응답 판정', () => {
  it('thread.id 를 꺼낸다', () => {
    expect(startedThreadId({ data: { thread: { id: 't9' }, userMessage: { id: 'm1' } } })).toBe('t9')
  })

  it.each([[null], [{}], [{ data: {} }], [{ data: { thread: { id: '' } } }]])(
    'id 가 없으면 null(%o)',
    payload => expect(startedThreadId(payload)).toBeNull(),
  )
})

describe('toChatSnapshot — transcript 변환', () => {
  it('서버 역할을 화면 역할로 옮기고 확인 시각을 남긴다', () => {
    const snapshot = toChatSnapshot(messagesPayload([
      row({ id: 'm1', role: 'user', content: '이번 주 홍보해줘' }),
      row({ id: 'm2', role: 'sohee', content: '사진을 골라 주세요.' }),
      row({ id: 'm3', role: 'system_event', content: '작업을 시작했어요.' }),
    ]), { limit: CHAT_MESSAGE_LIMIT, checkedAt: CHECKED_AT })

    expect(snapshot.loadState).toBe('ready')
    expect(snapshot.complete).toBe(true)
    expect(snapshot.checkedAt).toBe(CHECKED_AT)
    expect(snapshot.bubbles.map(bubble => [bubble.id, bubble.role])).toEqual([
      ['m1', 'owner'],
      ['m2', 'sohee'],
      ['m3', 'system'],
    ])
  })

  it('queued/streaming 만 전송 중으로 표시한다', () => {
    const snapshot = toChatSnapshot(messagesPayload([
      row({ id: 'm1', status: 'queued' }),
      row({ id: 'm2', status: 'streaming' }),
      row({ id: 'm3', status: 'completed' }),
      row({ id: 'm4', status: 'failed' }),
    ]), { limit: CHAT_MESSAGE_LIMIT, checkedAt: CHECKED_AT })

    expect(snapshot.bubbles.map(bubble => bubble.pending)).toEqual([true, true, false, false])
  })

  it('limit 을 꽉 채우면 더 오래된 대화가 남아 있을 수 있으므로 일부만 확인이다', () => {
    const rows = Array.from({ length: CHAT_MESSAGE_LIMIT }, (_, index) => row({ id: `m${index}` }))
    const snapshot = toChatSnapshot(messagesPayload(rows), { limit: CHAT_MESSAGE_LIMIT, checkedAt: CHECKED_AT })

    expect(snapshot.loadState).toBe('ready')
    expect(snapshot.complete).toBe(false)
  })

  it('해석하지 못한 행이 하나라도 있으면 완료로 읽히게 두지 않는다', () => {
    const snapshot = toChatSnapshot(messagesPayload([
      row({ id: 'm1' }),
      row({ id: 'm2', role: 'unknown_role' }),
    ]), { limit: CHAT_MESSAGE_LIMIT, checkedAt: CHECKED_AT })

    expect(snapshot.bubbles).toHaveLength(1)
    expect(snapshot.complete).toBe(false)
  })

  it('모양이 다른 응답은 빈 대화가 아니라 error 다', () => {
    expect(toChatSnapshot(null, { limit: CHAT_MESSAGE_LIMIT, checkedAt: CHECKED_AT }).loadState).toBe('error')
    expect(toChatSnapshot({ data: 'nope' }, { limit: CHAT_MESSAGE_LIMIT, checkedAt: CHECKED_AT }).loadState).toBe('error')
  })

  it('확인된 빈 목록만 빈 대화다', () => {
    const snapshot = toChatSnapshot(messagesPayload([]), { limit: CHAT_MESSAGE_LIMIT, checkedAt: CHECKED_AT })
    expect(snapshot.bubbles).toEqual([])
    expect(snapshot.complete).toBe(true)
    expect(snapshot.loadState).toBe('ready')
  })

  it('실패 스냅샷은 offline 일 때만 offline 표시를 붙인다', () => {
    expect(failedChatSnapshot(CHECKED_AT).offline).toBeUndefined()
    expect(failedChatSnapshot(CHECKED_AT, true)).toMatchObject({ loadState: 'error', offline: true })
    expect(emptyChatSnapshot(CHECKED_AT)).toMatchObject({ loadState: 'ready', complete: true })
  })
})

describe('unauthorizedChatSnapshot — 권한 없음은 조회 실패와 다르다', () => {
  it('unauthorized 표시를 붙이고 빈 대화로 만들지 않는다', () => {
    const snapshot = unauthorizedChatSnapshot(CHECKED_AT)
    expect(snapshot).toMatchObject({ loadState: 'error', unauthorized: true, bubbles: [], complete: false })
    expect(snapshot.loadState).not.toBe('ready')
  })
})

describe('failedOrStaleChatSnapshot — 확인된 대화를 실패로 덮지 않는다', () => {
  const confirmed = toChatSnapshot(messagesPayload([row()]), {
    limit: CHAT_MESSAGE_LIMIT,
    checkedAt: CHECKED_AT,
  })

  it('확인된 대화가 있으면 stale 로 남기고 확인 시각을 다시 쓰지 않는다', () => {
    const snapshot = failedOrStaleChatSnapshot(confirmed, '2026-10-24T02:00:00.000Z')
    expect(snapshot.loadState).toBe('stale')
    expect(snapshot.bubbles).toHaveLength(1)
    expect(snapshot.checkedAt).toBe(CHECKED_AT)
    expect(snapshot.unauthorized).toBeUndefined()
  })

  it('확인된 대화가 없으면 error 다', () => {
    expect(failedOrStaleChatSnapshot(null, CHECKED_AT)).toMatchObject({ loadState: 'error', bubbles: [] })
    // 빈 대화만 확인했던 경우도 '대화 없음'을 이전 내용처럼 붙여 두지 않는다.
    expect(failedOrStaleChatSnapshot(emptyChatSnapshot(CHECKED_AT), CHECKED_AT).loadState).toBe('error')
  })

  it('재연결 뒤 실패하면 이전 오프라인 표시를 물려받지 않는다', () => {
    const offlineStale = failedOrStaleChatSnapshot(confirmed, CHECKED_AT, true)
    expect(offlineStale.offline).toBe(true)

    // 연결이 돌아온 뒤 서버 문제로 실패 — 화면이 계속 연결 탓을 하면 안 된다.
    const reconnected = failedOrStaleChatSnapshot(offlineStale, CHECKED_AT, false)
    expect(reconnected.loadState).toBe('stale')
    expect(reconnected.offline).toBeFalsy()
  })
})

describe('sendOutcomeFromStream — 전송 판정', () => {
  it('서버가 시작·완료 신호를 주면 성공이다', () => {
    const body = [
      JSON.stringify({ type: 'message.started', messageId: 'a1' }),
      JSON.stringify({ type: 'message.delta', messageId: 'a1', delta: '안녕' }),
      JSON.stringify({ type: 'message.completed', messageId: 'a1' }),
    ].join('\n')

    expect(sendOutcomeFromStream({ status: 200, body })).toEqual({ ok: true })
  })

  it('서버가 실패 신호를 주면 그 문구를 그대로 쓴다', () => {
    const body = JSON.stringify({ type: 'message.failed', messageId: 'a1', code: 'X', message: '크레딧이 부족해요.' })
    expect(sendOutcomeFromStream({ status: 200, body }))
      .toEqual({ ok: false, message: '크레딧이 부족해요.' })
  })

  it('실패 문구가 비어 있으면 일반 실패 문구로 닫는다', () => {
    const body = JSON.stringify({ type: 'message.failed', messageId: 'a1', code: 'X', message: '  ' })
    expect(sendOutcomeFromStream({ status: 200, body }))
      .toEqual({ ok: false, message: CHAT_SEND_FAILED_NOTICE })
  })

  it('2xx 가 아니면 실패다', () => {
    expect(sendOutcomeFromStream({ status: 503, body: '' }))
      .toEqual({ ok: false, message: CHAT_SEND_FAILED_NOTICE })
  })

  it('시작·텍스트만 받고 끊긴 스트림은 성공으로 단정하지 않는다', () => {
    const body = [
      JSON.stringify({ type: 'message.started', messageId: 'a1' }),
      JSON.stringify({ type: 'message.delta', messageId: 'a1', delta: '확인 중' }),
    ].join('\n')
    expect(sendOutcomeFromStream({ status: 200, body }))
      .toEqual({ ok: false, message: CHAT_SEND_FAILED_NOTICE })
  })

  it('다른 응답의 완료 신호로 현재 응답을 완료 처리하지 않는다', () => {
    const body = [
      JSON.stringify({ type: 'message.started', messageId: 'a1' }),
      JSON.stringify({ type: 'message.completed', messageId: 'a2' }),
    ].join('\n')
    expect(sendOutcomeFromStream({ status: 200, body }))
      .toEqual({ ok: false, message: CHAT_SEND_FAILED_NOTICE })
  })

  it('시작 신호 없이 끊긴 스트림은 성공으로 단정하지 않는다', () => {
    expect(sendOutcomeFromStream({ status: 200, body: '' }))
      .toEqual({ ok: false, message: CHAT_SEND_FAILED_NOTICE })
    expect(sendOutcomeFromStream({ status: 200, body: 'not-json\n{"type":"unknown"}' }))
      .toEqual({ ok: false, message: CHAT_SEND_FAILED_NOTICE })
  })
})
