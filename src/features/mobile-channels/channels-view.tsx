'use client'

import { ExternalLink, Link2, Monitor, RefreshCw, ShieldCheck } from 'lucide-react'
import { StateView, type StateKind } from '@/components/mobile-ui'
import type { ShellScreenConfig } from '@/features/mobile-shell'
import type { LoadState } from '@/features/mobile-decision/contracts'
import {
  LEVEL_LABEL,
  MOBILE_CHANNELS_PATH,
  MOBILE_WORK_CONTENT_PATH,
  channelConnectHref,
  publishability,
  webhookStatusText,
  type ChannelId,
  type MobileChannelDto,
  type Publishability,
} from './channel-readiness'
import { connectRetryHref, type ConnectFlow } from './channels-connect'
import { ChannelAccountHelp } from '@/features/channels/ui/channel-account-help'
import { ChannelConnectNotice } from '@/features/channels/ui/channel-connect-notice'
import { getConnectNotice } from '@/features/channels/ui/channel-display'

export const CHANNEL_LABEL: Record<ChannelId, string> = {
  instagram: '인스타그램',
  threads: '스레드',
  naver_blog: '네이버 블로그',
  naver_place: '네이버 플레이스',
  daangn: '당근',
}

/** 서버 DTO를 그대로 받는 뷰 모델. 게시 가능 판정은 전부 channel-readiness 가 담당한다. */
export interface ChannelsViewSnapshot {
  loadState: LoadState
  channels: readonly MobileChannelDto[]
  checkedAt: string | null
  /**
   * 서버가 권한 없음(401/403)으로 답한 경우. '다시 확인'으로 풀리는 실패가 아니므로
   * 일반 조회 실패(error)와 구분해 보여준다. 같은 실패를 재시도로 반복시키지 않는다.
   */
  accessDenied?: boolean
  extendedScopesAllowed?: boolean
}

const ACTION_LABEL: Record<Extract<Publishability, { publishable: false }>['action'], string> = {
  connect: '계정 연결하기',
  reconnect: '다시 연결하기',
  check_external: '채널에서 확인하기',
  use_pc: 'PC에서 올리기',
  verify: '게시 가능 여부 확인하기',
  manual: '직접 올리기',
  wait: '조금 기다리기',
}

const ACTION_ICON: Record<Extract<Publishability, { publishable: false }>['action'], typeof Link2> = {
  connect: Link2,
  reconnect: RefreshCw,
  check_external: ExternalLink,
  use_pc: Monitor,
  verify: ShieldCheck,
  manual: ExternalLink,
  wait: RefreshCw,
}

/** M21 채널. 화면은 라우터/데이터 조회를 모르고 DTO만 받는다. */
export function MobileChannelsView(props: {
  snapshot: ChannelsViewSnapshot
  /** OAuth 복귀 쿼리. 상태 확정은 여전히 snapshot(readback) 몫이다. */
  connectFlow?: ConnectFlow | null
  workspaceId?: string
}) {
  const { snapshot, connectFlow = null } = props
  const kind = stateKind(snapshot)

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 pb-6 text-foreground">
      <header className="space-y-1 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">연결된 채널</h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          채널 쪽에서 확인된 상태만 보여드려요. 게시는 확인이 끝난 채널에서만 진행합니다.
        </p>
      </header>

      {connectFlow ? <ConnectFlowNotice flow={connectFlow} loadState={snapshot.loadState} /> : null}

      <StateView kind={kind} checkedAt={snapshot.checkedAt} skeleton="list" skeletonRows={5}>
        <ul aria-label="연결 채널" className="space-y-3">
          {snapshot.channels.map(channel => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              extendedScopesAllowed={snapshot.extendedScopesAllowed}
            />
          ))}
        </ul>
        <ChannelAccountHelp />
        <p className="text-xs leading-relaxed text-muted-foreground">
          연결됨 표시만으로는 게시하지 않아요. 게시 가능 여부가 확인된 채널에서만 진행합니다.
        </p>
      </StateView>
    </div>
  )
}

/** 연결이 끝나지 않은 결과. retry 는 다시 연결할 주소가 있을 때만 링크로 만든다. */
const FAILED_NOTICE: Partial<Record<ConnectFlow['result'], { title: string; message: string; retry: boolean }>> = {
  invalid: { title: '연결 정보가 맞지 않아요', message: '연결 요청이 만료되었거나 올바르지 않아요. 다시 연결해 주세요.', retry: true },
  unavailable: { title: '지금은 연결을 확인할 수 없어요', message: '잠시 뒤 다시 시도해 주세요.', retry: false },
  forbidden: { title: '이 계정으로는 연결할 권한이 없어요', message: '매장 대표 또는 관리자만 연결할 수 있어요. 권한을 확인한 뒤 다시 연결해 주세요.', retry: true },
}

/** OAuth 복귀 안내. 연결됐다는 쿼리만으로 '게시 가능'을 그리지 않는다 — readback 결과가 상태를 정한다. */
function ConnectFlowNotice({ flow, loadState }: { flow: ConnectFlow; loadState: LoadState }) {
  const box = 'space-y-1 rounded-2xl border border-border bg-muted/40 p-4'
  if (flow.safeCode) {
    return <ChannelConnectNotice notice={getConnectNotice(flow.result, flow.safeCode, { channel: flow.channel, returnPath: MOBILE_CHANNELS_PATH })} />
  }
  const failed = FAILED_NOTICE[flow.result]
  if (failed) {
    const href = failed.retry ? connectRetryHref(flow) : null
    return (
      <div role="status" className={box}>
        <p className="text-base font-semibold">{failed.title}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{failed.message}</p>
        {href ? <a href={href} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-2">다시 연결하기</a> : null}
      </div>
    )
  }
  if (flow.result === 'cancelled') {
    const href = connectRetryHref(flow)
    return (
      <div role="status" className={box}>
        <p className="text-base font-semibold">새 연결을 완료하지 못했어요</p>
        <p className="text-sm leading-relaxed text-muted-foreground">이번 연결은 취소되었거나 Meta에서 허용하지 않았어요. 기존 연결은 변경하지 않았어요. 원하시면 새 계정으로 다시 연결해 주세요.</p>
        {href ? <a href={href} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-2">다시 연결하기</a> : null}
      </div>
    )
  }
  if (loadState === 'loading') {
    return (
      <div role="status" aria-busy="true" className={box}>
        <p className="text-sm">연결을 확인하는 중이에요</p>
      </div>
    )
  }
  if (loadState === 'error' || loadState === 'unknown') {
    return (
      <div role="status" className={box}>
        <p className="text-base font-semibold">확인하지 못했어요</p>
        <p className="text-sm leading-relaxed text-muted-foreground">연결 상태를 확인하지 못했어요. 다시 확인해 주세요.</p>
        <a href={MOBILE_CHANNELS_PATH} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-2">다시 확인하기</a>
      </div>
    )
  }
  return (
    <div role="status" className={box}>
      <p className="text-sm">연결 상태를 확인했어요. 아래에서 확인해 주세요.</p>
    </div>
  )
}

function ChannelRow({
  channel,
  extendedScopesAllowed = false,
}: {
  channel: MobileChannelDto
  extendedScopesAllowed?: boolean
}) {
  const status = publishability(channel)
  const name = CHANNEL_LABEL[channel.id]
  const isMetaChannel = channel.id === 'instagram' || channel.id === 'threads'
  const extendedHref = isMetaChannel && extendedScopesAllowed
    ? `/api/channels/${channel.id}/connect?returnPath=/app/channels&extended=1`
    : null

  const changeHref = isMetaChannel && channel.level !== 'not_connected' && channel.level !== 'unknown'
    ? channelConnectHref(channel.id) : null
  const accountActions = <>
    {channel.username ? <p className="break-all text-sm text-muted-foreground">@{channel.username.replace(/^@+/, '')}</p> : null}
    {changeHref ? <a href={changeHref} aria-label={`${name} 다른 계정으로 변경`} className="inline-flex min-h-11 items-center text-base font-medium text-primary underline underline-offset-2">다른 계정으로 변경</a> : null}
  </>

  if (status.publishable) {
    return (
      <li className="flex min-h-14 items-start gap-3 rounded-2xl border border-border bg-card p-4">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <ShieldCheck aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate break-keep text-base font-semibold">{name}</p>
          {accountActions}
          <p className="text-sm text-primary">게시 가능</p>
          <p className="text-xs text-muted-foreground">{LEVEL_LABEL[channel.level]} · {lastCheckedText(channel.lastCheckedAt)}</p>
          <p className="text-xs text-muted-foreground">{webhookStatusText(channel.webhook_status)}</p>
          {extendedHref ? (
            <div className="pt-2">
              <a
                href={extendedHref}
                aria-label={`${name} 확장 권한으로 다시 연결 (댓글·DM·인사이트)`}
                className="inline-flex min-h-[44px] items-center text-[16px] font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                확장 권한으로 다시 연결 (댓글·DM·인사이트)
              </a>
            </div>
          ) : null}
        </div>
      </li>
    )
  }

  const isNaverDirect = channel.id === 'naver_blog' && !channel.publishSupported && status.action === 'use_pc'
  const Icon = ACTION_ICON[status.action]
  const actionLabel = isNaverDirect ? '원고 준비하러 가기' : ACTION_LABEL[status.action]
  // 연결·다시 연결은 실제로 시작할 수 있는 주소가 있을 때만 링크로 만든다.
  // 네이버 블로그 직접 게시는 모바일에서 유효한 원고/작업 목록(/app/content)으로 이동한다.
  const href =
    isNaverDirect
      ? MOBILE_WORK_CONTENT_PATH
      : status.action === 'connect' || status.action === 'reconnect'
        ? channelConnectHref(channel.id)
        : null
  return (
    <li className="flex min-h-14 items-start gap-3 rounded-2xl border border-border bg-card p-4">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon aria-hidden className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate break-keep text-base font-semibold">{name}</p>
          {accountActions}
        <p className="text-sm font-medium">{status.label}</p>
        <p className="break-keep text-sm leading-relaxed text-muted-foreground">{status.reason}</p>
        <p className="text-xs text-muted-foreground">{lastCheckedText(channel.lastCheckedAt)}</p>
        <p className="text-xs text-muted-foreground">{webhookStatusText(channel.webhook_status)}</p>
        {href ? (
          <a
            href={href}
            className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-2"
          >
            {actionLabel}
          </a>
        ) : (
          <p className="text-sm text-primary">{actionLabel}</p>
        )}
        {extendedHref ? (
          <div>
            <a
              href={extendedHref}
              aria-label={`${name} 확장 권한으로 다시 연결 (댓글·DM·인사이트)`}
              className="inline-flex min-h-[44px] items-center text-[16px] font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              확장 권한으로 다시 연결 (댓글·DM·인사이트)
            </a>
          </div>
        ) : null}
      </div>
    </li>
  )
}

function lastCheckedText(iso: string | null): string {
  if (!iso) return '마지막 점검 기록 없음'
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return '마지막 점검 기록 없음'
  const kst = new Date(t.getTime() + 9 * 3600_000)
  return `마지막 점검 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`
}

function stateKind(snapshot: ChannelsViewSnapshot): StateKind {
  if (snapshot.loadState === 'loading') return 'loading'
  // 권한 없음은 '내용이 없음'도 '일시적 조회 실패'도 아니다. 다시 확인해도 풀리지 않는다.
  if (snapshot.accessDenied === true) return 'unauthorized'
  if (snapshot.loadState === 'stale') return 'stale'
  if (snapshot.loadState === 'error' || snapshot.loadState === 'unknown') return 'error'
  if (snapshot.channels.length === 0) return 'confirmed_empty'
  return 'ready'
}

export function channelsScreenConfig(): ShellScreenConfig {
  return { mode: 'DETAIL', title: '채널', backHref: '/app/system' }
}
