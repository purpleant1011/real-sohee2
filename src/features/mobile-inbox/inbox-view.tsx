'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { StateView, StatusPill, type StateKind } from '@/components/mobile-ui'
import type { ShellScreenConfig } from '@/features/mobile-shell'
import { authFailureStateKind, type AuthFailure } from '@/features/mobile-shell/auth-failure'
import type { LoadState } from '@/features/mobile-decision/contracts'
import {
  CHANNEL_LABEL,
  STATUS_LABEL,
  channelCounts,
  inboxListView,
  replyPath,
  scopeThreads,
  type InboxChannel,
  type InboxThreadDto,
} from './inbox-model'

export interface InboxViewSnapshot {
  loadState: LoadState
  threads: InboxThreadDto[]
  workspaceId: string
  /** 서버가 목록 전체를 확인했는지. false 면 빈 목록을 '새 문의 없음'으로 단정하지 않는다. */
  complete: boolean
  checkedAt: string | null
  /**
   * 서버가 인증(401)·권한(403)을 거부한 경우(ANI-1714). '다시 확인'으로 풀리는 실패가 아니므로
   * 일반 조회 실패(error)와 구분해 보여준다. 401 이면 '로그인 만료', 403 이면 '권한 없음'이다.
   */
  authFailure?: AuthFailure
}

export interface InboxViewProps {
  snapshot: InboxViewSnapshot
  /** 복사 같은 수동 대안. 전송은 하지 않는다. */
  onCopyDraft?: (threadId: string, text: string) => void
  onOpenThread?: (threadId: string) => void
}

const CORE_CHANNELS: Array<InboxChannel | 'all'> = ['all', 'instagram_dm', 'instagram_comment', 'kakao', 'naver_talktalk']
const EXTRA_CHANNELS: InboxChannel[] = ['instagram', 'threads', 'naver_blog', 'naver_place']
const BTN = 'inline-flex min-h-11 items-center rounded-xl px-3.5 text-sm font-medium'

export function inboxScreenConfig(): ShellScreenConfig {
  return { mode: 'BROWSE', title: '소통함' }
}

/** M13 소통함. 화면은 DTO 만 받고 전송 경로를 갖지 않는다(검토 화면으로 넘기기만). */
export function MobileInboxView({ snapshot, onCopyDraft, onOpenThread }: InboxViewProps) {
  const [channel, setChannel] = useState<InboxChannel | 'all'>('all')
  const counts = channelCounts(snapshot.threads, snapshot.workspaceId)
  const scoped = scopeThreads(snapshot.threads, snapshot.workspaceId, channel)
  const view = inboxListView(snapshot.loadState, scoped, snapshot.complete)
  // 인증 만료·권한 없음은 '내용이 없음'도 '일시적 조회 실패'도 아니다. 다시 확인해도 풀리지 않는다.
  const kind: StateKind = snapshot.authFailure ? authFailureStateKind(snapshot.authFailure) : view.kind
  // 실제 데이터에 있는 추가 채널만 칩으로 보여 준다.
  const CHANNELS = [...CORE_CHANNELS, ...EXTRA_CHANNELS.filter(c => counts[c] > 0)]
  const unread = snapshot.threads.filter(t => t.workspaceId === snapshot.workspaceId && t.unread).length

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-6 text-foreground">
      <header className="space-y-1 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">소통함</h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          {snapshot.loadState === 'ready' && unread > 0 ? `안 읽은 문의 ${unread}건` : '손님이 보낸 문의를 확인하세요.'}
        </p>
      </header>

      {/* 권한이 없으면 건수도 알 수 없다. 0건 칩을 그리면 '문의가 없다'로 잘못 읽힌다. */}
      {kind === 'unauthorized' || kind === 'session_expired' ? null : (
        <div role="group" aria-label="채널 고르기" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 snap-x snap-mandatory scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CHANNELS.map(key => (
            <button
              key={key}
              type="button"
              aria-pressed={channel === key}
              onClick={() => setChannel(key)}
              className={`${BTN} shrink-0 snap-start whitespace-nowrap ${
                channel === key ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
              }`}
            >
              {key === 'all' ? '전체' : CHANNEL_LABEL[key]} {counts[key]}
            </button>
          ))}
        </div>
      )}

      <StateView
        kind={kind}
        checkedAt={snapshot.checkedAt}
        skeleton="list"
        skeletonRows={4}
        title={kind === 'confirmed_empty' ? '새 문의가 없어요' : undefined}
        description={kind === 'confirmed_empty' ? '받은 문의가 없습니다.' : undefined}
        action={kind === 'confirmed_empty' ? (
          <Button asChild variant="outline" className="min-h-12 w-full">
            <Link href="/app/work/new">소희에게 글 맡기기</Link>
          </Button>
        ) : undefined}
      >
        <ul aria-label="소통 목록" className="space-y-3">
          {scoped.map(t => (
            <ThreadRow key={t.id} thread={t} onCopyDraft={onCopyDraft} onOpenThread={onOpenThread} />
          ))}
        </ul>
      </StateView>
    </div>
  )
}

function ThreadRow({ thread, onCopyDraft, onOpenThread }: { thread: InboxThreadDto } & Pick<InboxViewProps, 'onCopyDraft' | 'onOpenThread'>) {
  const path = replyPath(thread)
  const name = thread.consent === 'withdrawn' ? maskName(thread.customerName) : thread.customerName
  const pillKind = thread.status === 'handled'
    ? 'verified'
    : thread.status === 'needs_reply'
      ? 'review'
      : thread.status === 'waiting_customer'
        ? 'awaiting_approval'
        : 'draft'

  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-base font-semibold">
          {thread.unread ? <span className="sr-only">안 읽음, </span> : null}
          {name}
        </p>
        <StatusPill kind={pillKind} label={STATUS_LABEL[thread.status]} compact className="shrink-0" />
      </div>

      <p className="truncate text-xs text-muted-foreground">
        {CHANNEL_LABEL[thread.channel]}
        {thread.lastMessage || thread.lastActivityAt
          ? ` · ${formatTime(thread.lastMessage?.receivedAt ?? thread.lastActivityAt ?? '')}`
          : ''}
      </p>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {onOpenThread ? (
          <button
            type="button"
            className={`${BTN} bg-primary text-primary-foreground`}
            onClick={() => onOpenThread(thread.id)}
          >
            {path.kind === 'review' ? '답안 검토하기' : '대화 보기'}
          </button>
        ) : null}
        {path.kind === 'manual' && thread.draft ? (
          <button
            type="button"
            className={`${BTN} bg-muted text-foreground`}
            onClick={() => onCopyDraft?.(thread.id, thread.draft!.text)}
          >
            답안 복사
          </button>
        ) : null}
      </div>
    </li>
  )
}

function maskName(name: string): string {
  const chars = [...name.trim()]
  if (chars.length <= 1) return chars.join('')
  if (chars.length === 2) return `${chars[0]}○`
  return `${chars[0]}${'○'.repeat(chars.length - 2)}${chars[chars.length - 1]}`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '시각 확인 못함'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(d)
}
