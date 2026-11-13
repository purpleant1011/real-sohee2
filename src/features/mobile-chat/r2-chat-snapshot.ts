/**
 * M10 대화 — 기존 서버 응답을 화면 스냅샷으로 옮기는 순수 변환과 전송 판정.
 *
 * 읽기는 새 API 없이 기존 경로만 쓴다.
 *  - GET  /api/workspaces/:id/conversations                 (대화 목록, 최신순)
 *  - GET  /api/workspaces/:id/conversations/:threadId/messages (최근 50개)
 *  - POST /api/workspaces/:id/conversations/:threadId/messages (NDJSON 스트림)
 *
 * 정직성 규칙:
 * - 목록·본문 모양이 다르면 '대화 없음'이 아니라 error 로 닫는다(fail-closed).
 * - 50개를 꽉 채워 받았으면 더 오래된 대화가 남아 있을 수 있으므로 complete=false(일부만 확인).
 * - 스트림이 끊겼거나 서버가 시작 신호조차 주지 않았으면 전송 성공으로 단정하지 않는다.
 *   화면은 전송 후 다시 조회한 서버 값만 믿는다.
 */

import { CHAT_SEND_FAILED_NOTICE, type ChatSendResult } from './chat-send'
import type { ChatViewSnapshot } from './mobile-chat-view'
import { toChatBubbles, type ChatRole } from './transcript'

/** 서버 GET messages 의 limit 과 같은 값. 이 수만큼 받았으면 잘렸을 수 있다. */
export const CHAT_MESSAGE_LIMIT = 50

export type ThreadLookup =
  | Readonly<{ ok: true; threadId: string | null }>
  | Readonly<{ ok: false }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * 대화 목록에서 가장 최근 대화 id 만 꺼낸다.
 * 목록이 비었으면 `{ ok: true, threadId: null }`(정말 대화 없음),
 * 응답 모양이 계약과 다르면 `{ ok: false }`(조회 실패 — 빈 목록으로 단정 금지).
 */
export function latestThreadId(payload: unknown): ThreadLookup {
  const data = isRecord(payload) ? payload.data : null
  const items = isRecord(data) ? data.items : null
  if (!Array.isArray(items)) return { ok: false }
  if (items.length === 0) return { ok: true, threadId: null }

  const first = items[0]
  const id = isRecord(first) ? nonEmptyString(first.id) : null
  return id === null ? { ok: false } : { ok: true, threadId: id }
}

/** POST /conversations 응답에서 새 대화 id. 없으면 null(호출부가 실패로 닫는다). */
export function startedThreadId(payload: unknown): string | null {
  const data = isRecord(payload) ? payload.data : null
  const thread = isRecord(data) ? data.thread : null
  return isRecord(thread) ? nonEmptyString(thread.id) : null
}

/** 서버 메시지 역할 → 화면 버블 역할. 모르는 역할은 버블을 만들지 않는다. */
const ROLE_BY_SERVER: Readonly<Record<string, ChatRole>> = {
  user: 'owner',
  sohee: 'sohee',
  system_event: 'system',
}

function isPendingStatus(value: unknown): boolean {
  return value === 'queued' || value === 'streaming'
}

/**
 * GET messages 응답(`{ data: [...] }`)을 화면 스냅샷으로 옮긴다.
 * 버블 id·본문이 없거나 역할을 모르는 행은 버리되, 하나라도 버렸으면 complete=false 로 닫는다.
 */
export function toChatSnapshot(
  payload: unknown,
  input: { limit: number; checkedAt: string },
): ChatViewSnapshot {
  const rows = isRecord(payload) && Array.isArray(payload.data) ? payload.data : null
  if (rows === null) return failedChatSnapshot(input.checkedAt)

  const candidates: Array<{
    id: string
    text: string
    role: ChatRole
    pending: boolean
    evidence: unknown
  }> = []
  let dropped = false

  for (const row of rows) {
    const record = isRecord(row) ? row : null
    const role = record && typeof record.role === 'string' ? ROLE_BY_SERVER[record.role] : undefined
    if (!record || role === undefined) {
      dropped = true
      continue
    }
    candidates.push({
      id: typeof record.id === 'string' ? record.id : '',
      text: typeof record.content === 'string' ? record.content : '',
      role,
      pending: isPendingStatus(record.status),
      evidence: Array.isArray(record.evidenceRefs) ? record.evidenceRefs : [],
    })
  }

  const bubbles = toChatBubbles(candidates)
  if (bubbles.length < candidates.length) dropped = true

  return {
    loadState: 'ready',
    bubbles,
    // 서버 확인이 끝난 전체 대화일 때만 complete. 잘렸거나 일부를 버렸으면 '일부만 확인'.
    complete: !dropped && rows.length < input.limit,
    checkedAt: input.checkedAt,
  }
}

export function loadingChatSnapshot(): ChatViewSnapshot {
  return { loadState: 'loading', bubbles: [], complete: false, checkedAt: null }
}

/** 대화가 정말 없을 때(서버가 빈 목록을 확인해 준 경우). */
export function emptyChatSnapshot(checkedAt: string): ChatViewSnapshot {
  return { loadState: 'ready', bubbles: [], complete: true, checkedAt }
}

/** 조회 실패. 빈 대화가 아니다 — 화면은 error 칩과 재확인만 보여 준다. */
export function failedChatSnapshot(checkedAt: string, offline = false): ChatViewSnapshot {
  return { loadState: 'error', bubbles: [], complete: false, checkedAt, ...(offline ? { offline } : {}) }
}

/**
 * 권한 없음(401/403). 조회 실패(error)와 섞지 않는다 — 다시 확인해도 풀리지 않는 상태다.
 * 화면은 '권한이 없어요'를 보여 주고 재확인 버튼을 주지 않는다.
 */
export function unauthorizedChatSnapshot(checkedAt: string): ChatViewSnapshot {
  // loadState 는 'error' 로 두되 unauthorized 로 화면 판정을 분리한다(입력 잠금은 동일).
  return { loadState: 'error', bubbles: [], complete: false, checkedAt, unauthorized: true }
}

/**
 * 다시 읽기가 실패했을 때의 스냅샷.
 *
 * 화면에 남아 있는 대화가 이전에 서버가 확인해 준 것이면 지우지 않고 `stale`(이전에 확인한 내용)로 표시한다.
 * 한 번도 확인된 대화가 없으면 일반 `error` 다. 확인된 대화를 실패로 덮어 '대화 없음'처럼 보이게 하지 않는다.
 */
export function failedOrStaleChatSnapshot(
  current: ChatViewSnapshot | null,
  checkedAt: string,
  offline = false,
): ChatViewSnapshot {
  const previous =
    current !== null && current.bubbles.length > 0 && current.loadState !== 'error' ? current : null
  if (previous === null) return failedChatSnapshot(checkedAt, offline)
  return {
    ...previous,
    loadState: 'stale',
    // 확인 시각은 마지막으로 서버가 확인해 준 시각 그대로 둔다(새 시각을 지어내지 않는다).
    checkedAt: previous.checkedAt,
    // 아직 서버 확정 전이던 버블은 '전송 중'으로 남겨 두지 않는다.
    queued: [],
    // 이전 전이의 오프라인 표시를 물려받지 않고 매번 덮어쓴다. 재연결 뒤 서버 문제로 실패했는데
    // 옛 표시가 남으면 화면이 계속 연결 탓을 해 원인을 잘못 짚는다(칩이 offline 을 먼저 본다).
    offline,
  }
}

export interface ChatStreamOutcomeInput {
  status: number
  /** 스트림 본문(NDJSON). 읽지 못했으면 빈 문자열. */
  body: string
}

/**
 * 전송 스트림 판정.
 *
 * - 2xx 가 아니면 실패.
 * - `message.failed` 가 오면 서버가 준 사용자 문구로 실패.
 * - 시작 신호만으로는 성공이 아니다. 같은 응답의 완료 신호가 있어야 한다.
 * - 재생 응답은 완료 신호만 줄 수 있지만, 시작 id가 있으면 그 id와 일치해야 한다.
 */
export function sendOutcomeFromStream({ status, body }: ChatStreamOutcomeInput): ChatSendResult {
  const httpOk = Number.isFinite(status) && status >= 200 && status < 300
  if (!httpOk) return { ok: false, message: CHAT_SEND_FAILED_NOTICE }

  let startedId: string | null = null
  let completedId: string | null = null
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue

    let event: unknown
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isRecord(event)) continue

    if (event.type === 'message.failed') {
      return { ok: false, message: nonEmptyString(event.message)?.trim() ?? CHAT_SEND_FAILED_NOTICE }
    }
    if (event.type === 'message.started') startedId = nonEmptyString(event.messageId)
    if (event.type === 'message.completed') completedId = nonEmptyString(event.messageId)
  }

  return completedId !== null && (startedId === null || startedId === completedId)
    ? { ok: true }
    : { ok: false, message: CHAT_SEND_FAILED_NOTICE }
}
