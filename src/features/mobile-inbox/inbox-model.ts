import type { LoadState } from '@/features/mobile-decision/contracts'
import { listView, type ListView } from '@/features/mobile-customers/customer-model'

/** 앞 4개는 대화형 채널, 뒤 4개는 실제 DB 가 구분하는 채널(DM·댓글 구분 없음). */
export type InboxChannel =
  | 'instagram_dm' | 'instagram_comment' | 'kakao' | 'naver_talktalk'
  | 'instagram' | 'threads' | 'naver_blog' | 'naver_place'
export type ThreadStatus = 'needs_reply' | 'draft_ready' | 'waiting_customer' | 'handled' | 'unknown'
export type ConsentState = 'granted' | 'withdrawn' | 'unknown'

/** 발송이 막힌 사유. 서버가 판정해서 내려주며 화면은 이 값을 풀 수 없다. */
export type SendBlocker = 'NO_SEND_SCOPE' | 'PROVIDER_NOT_READY' | 'CONSENT_MISSING' | 'WINDOW_EXPIRED' | 'KILL_SWITCH'

export interface InboxDraftDto {
  text: string
  /** 답안을 만든 근거 이름들(예: 가게 안내, 예약표). 비어 있으면 근거 없음으로 표시한다. */
  sources: string[]
}

export interface InboxThreadDto {
  id: string
  workspaceId: string
  channel: InboxChannel
  customerName: string
  consent: ConsentState
  status: ThreadStatus
  unread: boolean
  lastMessage: { text: string; receivedAt: string; fromCustomer: boolean } | null
  /** 원문 전체가 없을 때 서버가 가진 요약. 원문이 아니므로 '요약'으로만 표시한다. */
  summary?: string | null
  /** 마지막 활동 시각(원문이 없을 때 정렬·표시용). */
  lastActivityAt?: string | null
  draft: InboxDraftDto | null
  /** 서버 판정. 비어 있어야만 '보내기 검토' 로 넘어갈 수 있다. */
  sendBlockers: SendBlocker[]
}

export const CHANNEL_LABEL: Record<InboxChannel, string> = {
  instagram_dm: '인스타 DM',
  instagram_comment: '인스타 댓글',
  kakao: '카카오톡',
  naver_talktalk: '네이버 톡톡',
  instagram: '인스타그램',
  threads: '스레드',
  naver_blog: '네이버 블로그',
  naver_place: '네이버 플레이스',
}

export const STATUS_LABEL: Record<ThreadStatus, string> = {
  needs_reply: '답장 필요',
  draft_ready: '답안 준비됨',
  waiting_customer: '고객 답 기다림',
  handled: '처리 끝',
  unknown: '상태 확인 못함',
}

export const BLOCKER_LABEL: Record<SendBlocker, string> = {
  NO_SEND_SCOPE: '보내기 권한이 연결되지 않았어요',
  PROVIDER_NOT_READY: '채널 연결을 확인하지 못했어요',
  CONSENT_MISSING: '수신 동의를 확인하지 못했어요',
  WINDOW_EXPIRED: '답장 가능 시간이 지났어요',
  KILL_SWITCH: '자동 발송이 멈춰 있어요',
}

export type ReplyPath =
  | { kind: 'review'; reason: null }
  | { kind: 'manual'; reason: string }
  | { kind: 'none'; reason: string }

/**
 * 답안이 있어도 서버가 막으면 '직접 보내기(복사)'만 허용한다. 화면이 막힘을 풀지 않는다(fail-closed).
 * 답안이 없으면 보낼 것이 없다.
 */
export function replyPath(t: InboxThreadDto): ReplyPath {
  if (!t.draft) return { kind: 'none', reason: '소희 답안이 아직 없어요' }
  if (t.consent === 'withdrawn') return { kind: 'none', reason: '수신 동의가 철회돼 답장하지 않아요' }
  if (t.sendBlockers.length > 0) {
    return { kind: 'manual', reason: `${BLOCKER_LABEL[t.sendBlockers[0]]}. 복사해서 직접 보내 주세요.` }
  }
  if (t.consent !== 'granted' && t.channel !== 'instagram_comment') {
    return { kind: 'manual', reason: `${BLOCKER_LABEL.CONSENT_MISSING}. 복사해서 직접 보내 주세요.` }
  }
  return { kind: 'review', reason: null }
}

/** 다른 가게 스레드는 절대 포함하지 않고, 읽지 않은 것·최근 것 순으로 정렬한다. */
export function scopeThreads(threads: InboxThreadDto[], workspaceId: string, channel: InboxChannel | 'all'): InboxThreadDto[] {
  return threads
    .filter(t => t.workspaceId === workspaceId && (channel === 'all' || t.channel === channel))
    .sort((a, b) => {
      if (a.unread !== b.unread) return a.unread ? -1 : 1
      const at = (t: InboxThreadDto) => t.lastMessage?.receivedAt ?? t.lastActivityAt ?? ''
      return at(b).localeCompare(at(a))
    })
}

export function channelCounts(threads: InboxThreadDto[], workspaceId: string): Record<InboxChannel | 'all', number> {
  const counts: Record<InboxChannel | 'all', number> = {
    all: 0, instagram_dm: 0, instagram_comment: 0, kakao: 0, naver_talktalk: 0,
    instagram: 0, threads: 0, naver_blog: 0, naver_place: 0,
  }
  for (const t of threads) {
    if (t.workspaceId !== workspaceId) continue
    counts.all += 1
    counts[t.channel] += 1
  }
  return counts
}

export function inboxListView(state: LoadState, threads: InboxThreadDto[] | null, complete: boolean): ListView {
  return listView(state, threads, complete)
}
