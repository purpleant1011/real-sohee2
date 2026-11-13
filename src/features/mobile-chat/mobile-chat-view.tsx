'use client'

import type { ReactNode } from 'react'
import type { PublicChatResult } from '@/lib/agent-os/public-chat-result'
import type { AgentActivityEvent } from '@/features/agent-activity/activity-event'
import type { AgentProgressEvent } from '@/features/tool-runtime/agent-loop-engine'
import { AgentWorkspace } from './agent-workspace'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { StateChip, StateView, type StateChipKind } from '@/components/mobile-ui'
import type { LoadState } from '@/features/mobile-decision/contracts'
import type { ShellScreenConfig } from '@/features/mobile-shell'
import { ChatBody, ChatComposerHost } from './chat-parts'
import type { ChatSendResult } from './chat-send'
import { mergeBubbles } from './pending-bubbles'
import type { ChatBubble } from './transcript'

/**
 * M10 소희와 대화 — R2 화면 본문.
 *
 * W1 실측 기준 이 화면은 아직 없다. 대화 버블·실행 카드·전송 컴포저는
 * `chat-parts` 가 이미 소유하므로 여기서 다시 만들지 않고 조립만 한다.
 *
 * 정직성 규칙:
 * - 서버 transcript 가 불완전하면 '일부만 확인' 칩을 붙이고 완료로 읽히는 문구를 쓰지 않는다.
 * - 조회 실패는 빈 대화가 아니다. error 칩과 재확인 행동만 보여 준다.
 * - 진행 카드는 `chat-parts` 의 `ChatExecutionCard` 판정을 그대로 쓴다(셸에서 위장 금지).
 */

/** 5상태 칩 매핑. ready + complete 일 때만 칩이 없다(확인된 전체). */
export function chatStateChip(input: {
  loadState: LoadState
  complete: boolean
  offline?: boolean
  unauthorized?: boolean
}): StateChipKind | null {
  // 권한 없음(401/403)은 조회 실패가 아니다. '확인 실패' 칩으로 뭉개지 않는다.
  if (input.unauthorized) return null
  if (input.offline) return 'offline'
  switch (input.loadState) {
    case 'loading':
      return 'loading'
    case 'error':
      return 'error'
    case 'stale':
      return 'stale'
    case 'unknown':
      return 'partial'
    case 'ready':
      return input.complete ? null : 'partial'
  }
}

export interface ChatViewSnapshot {
  loadState: LoadState
  bubbles: readonly ChatBubble[]
  /** 서버가 확정한 실행 단계. 모르는 값이면 카드를 만들지 않는다. */
  stage?: unknown
  /** 외부 결과 확인 단계에서 서버 산출물이 있는지. */
  hasServerOutput?: unknown
  /** 서버가 transcript 전체를 확인했는지. false 면 빈 대화를 '대화 없음'으로 단정하지 않는다. */
  complete: boolean
  checkedAt: string | null
  /** 방금 보냈지만 아직 서버 확정 전인 버블. */
  queued?: readonly ChatBubble[]
  /** 조회 중 네트워크가 끊긴 상태. */
  offline?: boolean
  /** 401/403 — 이 매장의 대화를 볼 권한이 없다. 일반 조회 실패(error)와 구분한다. */
  unauthorized?: boolean
  sending?: boolean
  uncertain?: boolean
  agentRunId?: string
  agentResult?: PublicChatResult
  activities?: AgentActivityEvent[]
  activityUnavailable?: boolean
  progress?: AgentProgressEvent
}

export interface MobileChatViewProps {
  snapshot: ChatViewSnapshot
  onSend: (text: string) => ChatSendResult | Promise<ChatSendResult>
  /** 조회 실패·오래된 내용일 때 다시 확인. */
  onRetry?: () => void
  /** 진행 중인 업무로 돌아가는 내부 경로. 셸 밖/외부 주소는 넘기지 않는다. */
  returnHref?: string | null
  /**
   * 기본 true. 셸의 CHAT 모드에 마운트할 때는 셸이 하단 컴포저 슬롯을 소유하므로
   * false 로 두고 `chatComposer(onSend)` 를 `ShellScreen` 의 `composer` 에 넘긴다.
   */
  showComposer?: boolean
  /** 대화가 정말 비었을 때의 문구. */
  emptyLabel?: string
  onSelectSuggestion?: (suggestion: string) => void
  suggestions?: readonly string[]
}

/** 셸 컴포저 슬롯에 넣을 요소. W1 마운트 시 사용한다. */
export function chatComposer(onSend: MobileChatViewProps['onSend'], disabled = false): ReactNode {
  return <ChatComposerHost onSend={onSend} disabled={disabled} />
}

/** CHAT 모드 셸 설정. 마운트는 W1 이 한다(이 PR 은 라우트를 건드리지 않는다). */
export function chatScreenConfig(): ShellScreenConfig {
  return { mode: 'CHAT', title: '소희와 대화' }
}

const BTN =
  'inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-secondary px-4 text-sm font-medium text-secondary-foreground'

export function MobileChatView({
  snapshot,
  onSend,
  onRetry,
  returnHref = null,
  showComposer = true,
  emptyLabel,
  onSelectSuggestion,
  suggestions,
}: MobileChatViewProps) {
  const chip = chatStateChip({
    loadState: snapshot.loadState,
    complete: snapshot.complete,
    offline: snapshot.offline,
    unauthorized: snapshot.unauthorized,
  })
  const blocked = snapshot.loadState === 'loading' || snapshot.loadState === 'error' || snapshot.unauthorized === true

  return (
    <div data-mobile-chat className="mx-auto w-full max-w-2xl space-y-4 pb-6 text-foreground">
      <header className="space-y-2 pt-1">
        {showComposer ? <h1 className="text-lg font-semibold tracking-tight">소희와 대화</h1> : null}
        {snapshot.bubbles.length === 0 ? <p className="text-sm leading-relaxed text-muted-foreground">
          필요한 일을 이야기해 주세요. 소희의 작업 과정도 함께 보여 드려요.
        </p> : null}
        {chip ? (
          <div className="flex flex-wrap items-center gap-2">
            <StateChip kind={chip} />
            {snapshot.checkedAt ? (
              <span className="text-xs text-muted-foreground">마지막 확인 {formatCheckedAt(snapshot.checkedAt)}</span>
            ) : null}
          </div>
        ) : null}
      </header>

      {snapshot.unauthorized ? (
        // 권한 없음은 다시 확인해도 풀리지 않는다. 재확인 버튼을 주지 않고 관리자에게 권한을 요청하게 한다.
        <StateView kind="unauthorized" skeleton="text" />
      ) : snapshot.loadState === 'error' ? (
        <StateView
          kind="error"
          skeleton="text"
          description="대화 내용을 불러오지 못했어요. 없어진 대화가 아니라 확인에 실패한 상태예요."
          action={onRetry ? <button type="button" onClick={onRetry} className={BTN}>다시 확인</button> : undefined}
        />
      ) : snapshot.loadState === 'loading' ? (
        <StateView kind="loading" skeleton="text" title="대화를 확인하는 중이에요" />
      ) : (
        <ChatBody
          bubbles={mergeBubbles(snapshot.bubbles, snapshot.queued ?? [])}
          stage={snapshot.stage}
          hasServerOutput={snapshot.hasServerOutput}
          emptyLabel={emptyLabel}
          work={<AgentWorkspace snapshot={snapshot} onRetry={onRetry} />}
          onSelectSuggestion={onSelectSuggestion ?? (suggestion => { void onSend(suggestion) })}
          suggestions={suggestions}
        >
          {returnHref ? (
            <Link href={returnHref} className={BTN}>
              진행 중인 업무로 돌아가기
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </ChatBody>
      )}

      {showComposer && !blocked ? <ChatComposerHost onSend={onSend} disabled={snapshot.sending || snapshot.uncertain} /> : null}

      {snapshot.loadState === 'stale' && onRetry ? (
        <button type="button" onClick={onRetry} className={BTN}>최신 내용으로 다시 확인</button>
      ) : null}
    </div>
  )
}

/** 확인 시각은 한국어 짧은 형식으로만 쓴다. 잘못된 값은 시각을 지어내지 않는다. */
function formatCheckedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '시각 확인 못함'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date)
}
