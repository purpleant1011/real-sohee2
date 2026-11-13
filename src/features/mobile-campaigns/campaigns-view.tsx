'use client'

import { CalendarClock, Megaphone, RefreshCw, Send, Users } from 'lucide-react'
import { StateView, type StateKind } from '@/components/mobile-ui'
import type { ShellScreenConfig } from '@/features/mobile-shell'
import type { LoadState } from '@/features/mobile-decision/contracts'
import type { MobileCustomerDto } from '@/features/mobile-customers/customer-model'
import type { CreditLedger } from '@/features/mobile-settings/credit-model'
import {
  campaignReadiness,
  conversionDisplay,
  openSlots,
  type CampaignBlocker,
  type CampaignProposal,
  type CampaignReadiness,
  type ChannelPublishState,
  type EmptySlot,
} from './campaign-model'

/** 라우터가 넘기는 제안 한 건의 재료. 판정은 전부 campaign-model 이 담당한다. */
export interface CampaignCandidate {
  proposal: CampaignProposal
  /** 빈자리 구조대가 아니면 null. */
  slot: EmptySlot | null
  channel: ChannelPublishState
  ledger: CreditLedger
  /** 소희가 계산한 예상 비용. 실적이 아니다. */
  estimate: number | null
  /** 서버가 확인한 실측 전환. 소스가 없으면 null 이고 예상으로 대체하지 않는다. */
  actualConversions: number | null
  actualSource: string | null
  /**
   * 승인 요청에 그대로 실어 보내는 제안 지문(서버 계산). 없으면 승인 요청을 보내지 않는다.
   * 화면 판정에는 쓰지 않는다 — 승인 라우트가 같은 값으로 다시 계산해 대조한다.
   */
  fingerprint?: string | null
}

export interface CampaignsViewSnapshot {
  loadState: LoadState
  candidates: readonly CampaignCandidate[]
  customers: readonly MobileCustomerDto[]
  /** 빈자리 관측 시각을 판정하는 기준 시각. 확인하지 못했으면 null 이고, 그때는 빈자리를 열린 것으로 보지 않는다. */
  now: string | null
  checkedAt: string | null
}

const KIND_LABEL: Record<CampaignProposal['kind'], string> = {
  empty_slot_rescue: '빈자리 구조대',
  revisit: '다시 찾아오기',
}

const CTA_BASE = 'inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3.5 text-sm font-medium'

/** M18 제안. 화면은 발송하지 않는다. 모든 확인이 끝난 제안만 승인 버튼이 열린다. */
export function MobileCampaignsView({
  snapshot,
  onApprove,
  example = false,
}: {
  snapshot: CampaignsViewSnapshot
  onApprove: (proposal: CampaignProposal) => void
  /** 예시 마운트면 숫자 옆에 '예시' 표시를 붙인다. 실화면은 기본값(false) 그대로다. */
  example?: boolean
}) {
  const cards = snapshot.candidates.map(candidate => ({
    candidate,
    ...reviewCandidate(candidate, snapshot),
  }))
  const kind = stateKind(snapshot, cards.length)

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-6 text-foreground">
      <header className="space-y-1 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">제안</h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          빈자리·수신 동의·보낼 채널·크레딧을 모두 확인한 뒤에만 승인할 수 있어요. 승인해도 소희가 바로 보내지 않고, 보내기 전에 한 번 더 확인해요.
        </p>
      </header>

      <StateView
        kind={kind}
        checkedAt={snapshot.checkedAt}
        skeleton="list"
        skeletonRows={3}
        title={kind === 'confirmed_empty' ? '제안이 없어요' : undefined}
        description={kind === 'confirmed_empty' ? '확인해 보니 지금 제안할 캠페인이 없습니다.' : undefined}
      >
        <ul aria-label="캠페인 제안" className="space-y-3">
          {cards.map(card => (
            <CampaignCard
              key={`${card.candidate.proposal.workspaceId}:${card.candidate.proposal.id}`}
              candidate={card.candidate}
              readiness={card.readiness}
              preApproval={card.preApproval}
              slotStale={card.slotStale}
              example={example}
              onApprove={onApprove}
            />
          ))}
        </ul>
        <p className="pt-2 text-xs leading-relaxed text-muted-foreground">
          예상 예약 수는 소희 계산값이고 실적이 아니에요. 실제 결과는 발송 뒤 서버가 확인한 값으로만 표시해요.
        </p>
      </StateView>
    </div>
  )
}

function CampaignCard({
  candidate,
  readiness,
  preApproval,
  slotStale,
  example,
  onApprove,
}: {
  candidate: CampaignCandidate
  readiness: CampaignReadiness
  preApproval: CampaignReadiness
  slotStale: boolean
  example: boolean
  onApprove: (proposal: CampaignProposal) => void
}) {
  const { proposal, slot, channel } = candidate
  const approved = proposal.approvedAt !== null
  // 승인 전에는 '승인만 하면 되는지'를 보여주고, 승인 뒤에는 실제 발송 가능 여부를 보여준다.
  const blockers = approved ? readiness.blockers : preApproval.blockers
  const canApprove = !approved && preApproval.allowed
  const conversion = conversionDisplay(proposal.estimatedConversions, candidate.actualConversions, candidate.actualSource)
  const exclusionReasons = summarizeExclusions(preApproval)
  const reasonId = `campaign-reason-${proposal.workspaceId}-${proposal.id}`

  return (
    <li className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="space-y-0.5">
        <p className="text-xs font-medium text-muted-foreground">{KIND_LABEL[proposal.kind]}</p>
        <p className="text-base font-semibold">{approved ? '승인 완료' : '사장님 승인 전'}</p>
        {slot ? (
          <p className="inline-flex items-center gap-1.5 text-sm leading-5 text-muted-foreground">
            <CalendarClock aria-hidden className="size-4" />
            {slot.serviceLabel} · {formatSlotTime(slot.startsAt)}
          </p>
        ) : null}
        {/* 오래된 빈자리 관측은 열린 자리로 주장하지 않는다. */}
        {slotStale ? <p className="text-sm leading-5 text-state-warn">빈자리 정보가 오래되어 다시 확인이 필요해요</p> : null}
      </div>

      <p className="whitespace-pre-wrap rounded-xl bg-muted/40 px-3 py-2.5 text-sm leading-6">{proposal.message}</p>

      <dl className="space-y-1 text-xs leading-5 text-muted-foreground">
        <div className="flex gap-2">
          <dt className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground">
            <Users aria-hidden className="size-3.5" />
            받을 고객
          </dt>
          <dd className="min-w-0">
            {preApproval.audience.eligible.length > 0
              ? `${preApproval.audience.eligible.length}명`
              : '지금 연락해도 되는 고객이 없어요'}
            {example ? <ExampleTag /> : null}
          </dd>
        </div>
        {exclusionReasons.length > 0 ? (
          <div className="flex gap-2">
            <dt className="shrink-0 font-medium text-foreground">제외</dt>
            <dd className="min-w-0">{exclusionReasons.join(' · ')}</dd>
          </div>
        ) : null}
        <div className="flex gap-2">
          <dt className="shrink-0 font-medium text-foreground">보낼 채널</dt>
          <dd className="min-w-0">{channel.channelLabel}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-medium text-foreground">결과</dt>
          <dd className="min-w-0">
            {conversion.label}
            {conversion.detail ? ` · ${conversion.detail}` : null}
            {example ? <ExampleTag /> : null}
          </dd>
        </div>
      </dl>

      {blockers.length > 0 ? (
        <ul id={reasonId} className="space-y-1 text-sm leading-5 text-muted-foreground">
          {blockers.map(blocker => (
            <li key={blocker.code}>
              {blocker.message}
              {blocker.next ? ` · ${blocker.next}` : null}
            </li>
          ))}
        </ul>
      ) : null}

      {approved ? (
        readiness.allowed ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-state-ok">
            <Send aria-hidden className="size-4" />
            발송 준비 완료 · 외부 게시 전
          </p>
        ) : (
          <p className="inline-flex items-center gap-1.5 text-sm text-state-warn">
            <RefreshCw aria-hidden className="size-4" />
            승인은 됐지만 지금은 보낼 수 없어요
          </p>
        )
      ) : (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => onApprove(proposal)}
            disabled={!canApprove}
            aria-disabled={!canApprove}
            aria-describedby={!canApprove && blockers.length > 0 ? reasonId : undefined}
            className={`${CTA_BASE} ${canApprove ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
          >
            <Megaphone aria-hidden className="size-4" />
            문구 확인하고 승인
          </button>
        </div>
      )}
    </li>
  )
}

interface CandidateReview {
  readiness: CampaignReadiness
  preApproval: CampaignReadiness
  slotStale: boolean
}

/** 승인 여부를 반영한 실제 판정과, 승인 전에 미리 보는 판정을 함께 만든다. */
function reviewCandidate(candidate: CampaignCandidate, snapshot: CampaignsViewSnapshot): CandidateReview {
  const slotStale = candidate.slot !== null && !isSlotFresh(candidate.slot, snapshot.now)
  // 신선도를 확인하지 못한 빈자리는 열린 자리로 넘기지 않는다(fail-closed).
  const verifiedSlot = candidate.slot !== null && !slotStale ? candidate.slot : null
  const base = {
    proposal: candidate.proposal,
    slot: verifiedSlot,
    customers: [...snapshot.customers],
    channel: candidate.channel,
    ledger: candidate.ledger,
    estimate: candidate.estimate,
  }
  return {
    readiness: campaignReadiness({ ...base, ownerApproved: candidate.proposal.approvedAt !== null }),
    // 사장님 승인만 남았는지 보기 위해 승인된 것으로 가정해 한 번 더 판정한다.
    preApproval: campaignReadiness({ ...base, ownerApproved: true }),
    slotStale,
  }
}

function isSlotFresh(slot: EmptySlot, now: string | null): boolean {
  if (now === null) return false
  return openSlots([slot], now).length === 1
}

/** 고객 ID 대신 사유별 인원만 보여준다. */
function summarizeExclusions(readiness: CampaignReadiness): string[] {
  const counts = new Map<string, number>()
  for (const exclusion of readiness.audience.excluded) {
    counts.set(exclusion.reason, (counts.get(exclusion.reason) ?? 0) + 1)
  }
  return [...counts].map(([reason, count]) => `${reason} ${count}명`)
}

// 서버(Node ICU)와 브라우저(ICU)가 만드는 문자열이 갈리면 하이드레이션이 어긋난다.
// 로케일·시간대·12/24시간제를 모두 고정해 `오후`/`PM` 차이를 없앤다.
const SLOT_TIME_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function formatSlotTime(startsAt: string): string {
  const parsed = Date.parse(startsAt)
  if (Number.isNaN(parsed)) return '시간 확인 필요'
  try {
    return SLOT_TIME_FORMAT.format(new Date(parsed))
  } catch {
    return '시간 확인 필요'
  }
}

/** 예시 마운트에서만 붙는 '예시' 표시. 실화면 숫자에는 붙지 않는다. */
function ExampleTag() {
  return (
    <span
      data-example-badge
      className="ml-1.5 inline-block shrink-0 whitespace-nowrap rounded-full bg-secondary px-1.5 py-0.5 align-middle text-xs font-medium text-secondary-foreground"
    >
      예시
    </span>
  )
}

function stateKind(snapshot: CampaignsViewSnapshot, count: number): StateKind {
  if (snapshot.loadState === 'loading') return 'loading'
  if (snapshot.loadState === 'stale') return 'stale'
  if (snapshot.loadState === 'error' || snapshot.loadState === 'unknown') return 'error'
  if (count === 0) return 'confirmed_empty'
  return 'ready'
}

export function campaignsScreenConfig(): ShellScreenConfig {
  return { mode: 'BROWSE', title: '제안' }
}

/** 테스트/라우터가 막힌 이유를 그대로 보여줄 때 쓰는 얇은 재노출. */
export type CampaignBlockerView = CampaignBlocker
