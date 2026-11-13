/**
 * M08 첫 결과와 증거 화면 (ANI-1681).
 *
 * 정본: `docs/mobile-r2/01-onboarding-creative-chat.md` §M08
 *       `docs/mobile-r2/00-product-ia-and-baseline.md` M08
 *
 * 이 파일이 지키는 경계:
 * - 화면은 게시 상태를 **다시 판정하지 않는다.** `publish-outcome.ts`의 결과를 받아
 *   사용자 문구와 다음 행동으로만 옮긴다. 다만 근거가 어긋나면(링크 무효·시각 파싱 실패·
 *   다른 계정에서 확인·대상 계정 미상) VERIFIED 를 **낮출 수만** 있다. 올릴 수는 없다.
 * - 서버 `overallStatus=ALL_VERIFIED` 또는 전송 API 200 만으로는 성공 화면을 만들지 않는다.
 *   성공 카드의 유일한 근거는 독립 readback(permalink + 게시 시각)이다.
 * - 축하(confetti)·완료 토스트는 모든 표시 채널이 VERIFIED 일 때만이다.
 *   확인되지 않은 카드가 하나라도 있으면 '완료' 라는 말을 쓰지 않는다.
 * - 수동 전달(복사·다운로드)은 게시가 아니다. `MANUAL` 카드로만 표시하고
 *   "직접 확인" 안내를 붙이며, 축하·첫 가치 이벤트에 포함하지 않는다.
 * - 확인 중(RESULT_UNKNOWN 포함)에는 재게시 버튼을 열지 않는다. 중복 게시 방지가 우선이다.
 * - 첫 가치 퍼널 이벤트는 독립 readback 으로 게시가 확인된 순간에만 만들어진다.
 *
 * 네트워크를 모른다. 새로고침·재시도 실행은 호출 측이 주입한다.
 */
import { CHANNEL_NAME, PREVIEW_CHANNELS, type PreviewChannel } from './preview-set'
import type { ChannelOutcome, FirstPostOutcome, OutcomeChannel, OverallState } from './publish-outcome'

/* ------------------------------------------------------------------ */
/* 입력                                                               */
/* ------------------------------------------------------------------ */

export type ManualMethod = 'COPY' | 'DOWNLOAD'

/** 사용자가 직접 전달했다고 표시한 기록. 게시 확인 근거가 아니다. */
export interface ManualDelivery {
  method: ManualMethod
  /** 사용자가 전달했다고 표시한 시각. 없으면 만들지 않는다. */
  sentAt?: string
}

/** 승인 시점에 화면에서 확인한 대상 계정. 서버 readback 계정과 대조한다. */
export interface ResultEvidence {
  /** M07 승인 스냅샷의 게시 대상 계정. 비어 있으면 대상이 확인되지 않은 것이다. */
  approvedHandle: string | null
  /** 독립 readback 에서 관측된 계정. 서버가 줄 때만 존재한다. */
  readbackAccount?: string | null
}

export interface ResultScreenInput {
  /** `deriveFirstPostOutcome()` 결과. 화면은 이 값을 확정 사실로 취급한다. */
  outcome: FirstPostOutcome
  evidence?: Partial<Record<OutcomeChannel, ResultEvidence>>
  /** 수동 전달(복사·다운로드) 기록. 게시 성공으로 승격되지 않는다. */
  manual?: Partial<Record<OutcomeChannel, ManualDelivery>>
}

/* ------------------------------------------------------------------ */
/* 표시 상태                                                          */
/* ------------------------------------------------------------------ */

/** M08 화면 카드 4상태 + 수동 전달. `MANUAL` 은 게시 확인이 아니다. */
export type ResultCardState = 'VERIFIED' | 'CHECKING' | 'UNKNOWN' | 'FAILED' | 'MANUAL'

export const RESULT_ACTION_LABEL = {
  NEXT_POST: '다음 소식 맡기기',
  VIEW_CUSTOMER_LINK: '고객에게 보일 링크 확인',
  REFRESH: '결과 새로고침',
  RETRY: '다시 시도',
  OPEN_POST: '게시물 보기',
  COPY_TEXT: '복사',
  DOWNLOAD_IMAGE: '다운로드',
} as const

export type ResultAction = keyof typeof RESULT_ACTION_LABEL

export interface ResultActionItem {
  action: ResultAction
  label: string
  /** 게시물 링크처럼 실제 주소가 있는 행동에만 붙는다. */
  href?: string
  channel?: PreviewChannel
}

export interface ResultChannelCard {
  channel: PreviewChannel
  name: string
  state: ResultCardState
  label: string
  detail: string
  /** 검증된 게시물 주소. http(s) 이고 근거가 맞을 때만. */
  permalink?: string
  /** 게시 시각 표시(Asia/Seoul). 읽을 수 있는 값일 때만. */
  postedAtLabel?: string
  /** 대상 계정 표시. 확인된 경우에만. */
  accountLabel?: string
  /** 다음 점검 방법. 확인 중·확인 불가에만. */
  nextCheck?: string
  /** 재게시를 열어도 되는 유일한 경우: 실패 + 서버가 재시도 가능하다고 한 경우. */
  retryAllowed: boolean
  /** 수동 전달 시 "직접 확인" 안내. */
  manualNotice?: string
  /** 사용자에게 보여줄 증거가 실제로 그려졌는지. */
  evidenceShown: boolean
  actions: readonly ResultActionItem[]
}

export interface FirstValueEvent {
  event: 'FIRST_VALUE_DELIVERED'
  /** 게시 확인 시각. 서버 readback 의 verifiedAt 만 쓴다(클라이언트 시계 금지). */
  at: string
  /** 퍼널 근거. API 응답이 아니라 독립 readback 이다. */
  source: 'PROVIDER_READBACK'
  channels: readonly PreviewChannel[]
}

export interface ResultScreen {
  title: string
  overall: OverallState
  /** 모든 표시 채널이 근거까지 갖춰 VERIFIED 일 때만 true. */
  celebrate: boolean
  /** 축하일 때만 만들어진다. 확인 전에는 어떤 완료 토스트도 없다. */
  completionToast: string | null
  cards: readonly ResultChannelCard[]
  primaryAction: ResultActionItem | null
  secondaryAction: ResultActionItem | null
  /** 축하일 때만 있는 고객용 링크. 주소를 지어내지 않는다. */
  customerLink: { label: string; href: string } | null
  /** 독립 readback 으로 첫 게시를 확인한 순간에만 생성된다. */
  firstValueEvent: FirstValueEvent | null
  /** 확인 중인 채널이 있을 때의 공통 안내. */
  pendingNote: string | null
  /** 수동 전달 카드가 있을 때의 공통 안내. */
  manualNotice: string | null
}

/* ------------------------------------------------------------------ */
/* 근거 검증 — 낮추기만 한다                                          */
/* ------------------------------------------------------------------ */

/**
 * 게시물 링크로 쓸 수 있는 주소만 통과시킨다.
 * javascript:/data:/상대 경로/공백 포함 문자열은 통과하지 못한다.
 */
export function evidencePermalink(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname || !url.hostname.includes('.')) return null
    return url.toString()
  } catch {
    return null
  }
}

const POSTED_AT_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** 읽을 수 없는 시각은 표시하지 않는다. 임의로 현재 시각을 채우지 않는다. */
export function postedAtLabel(iso: string | null | undefined): string | null {
  if (typeof iso !== 'string' || iso.trim() === '') return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return POSTED_AT_FORMAT.format(new Date(ms))
}

const HANDLE_PREFIX = /^@/

function cleanHandle(handle: string | null | undefined): string | null {
  if (typeof handle !== 'string') return null
  const trimmed = handle.trim().replace(HANDLE_PREFIX, '')
  return trimmed === '' ? null : trimmed
}

/**
 * readback 계정과 승인 계정 대조.
 * - 승인 계정 미상: 성공 표시 불가(대상 확인 없이 성공을 말하지 않는다).
 * - readback 계정 미상: 승인 계정을 표시한다(대조할 근거가 없을 뿐, 다른 계정이라는 뜻은 아니다).
 * - 둘 다 있고 다르면: 다른 계정의 게시물이므로 성공 표시 불가.
 */
function accountVerdict(evidence: ResultEvidence | undefined): {
  state: 'OK' | 'UNKNOWN' | 'MISMATCH'
  label: string | null
} {
  const approved = cleanHandle(evidence?.approvedHandle)
  const observed = cleanHandle(evidence?.readbackAccount)
  if (!approved) return { state: 'UNKNOWN', label: null }
  if (observed && observed !== approved) return { state: 'MISMATCH', label: null }
  return { state: 'OK', label: observed ?? approved }
}

/* ------------------------------------------------------------------ */
/* 카드                                                               */
/* ------------------------------------------------------------------ */

function checkingCard(channel: PreviewChannel, base: ChannelOutcome): ResultChannelCard {
  return {
    channel,
    name: CHANNEL_NAME[channel],
    state: 'CHECKING',
    label: `${CHANNEL_NAME[channel]} 외부 확인 중`,
    detail: base.detail,
    nextCheck: '잠시 뒤 결과를 새로고침하면 다시 확인할 수 있어요.',
    retryAllowed: false,
    evidenceShown: false,
    actions: [],
  }
}

function unknownCard(channel: PreviewChannel, detail: string): ResultChannelCard {
  return {
    channel,
    name: CHANNEL_NAME[channel],
    state: 'UNKNOWN',
    label: `${CHANNEL_NAME[channel]} 결과 확인 불가`,
    detail,
    nextCheck: '채널 앱에서 직접 확인해 주세요. 같은 내용을 다시 올리면 중복될 수 있어요.',
    retryAllowed: false,
    evidenceShown: false,
    actions: [],
  }
}

function manualCard(channel: PreviewChannel, manual: ManualDelivery): ResultChannelCard {
  return {
    channel,
    name: CHANNEL_NAME[channel],
    state: 'MANUAL',
    label: `${CHANNEL_NAME[channel]} 직접 전달`,
    detail: '직접 전달한 내용은 외부 게시 확인 전이에요.',
    nextCheck: undefined,
    retryAllowed: false,
    manualNotice:
      manual.method === 'COPY'
        ? '복사한 내용을 채널에 올렸다면 실제 게시 여부는 채널에서 직접 확인해 주세요.'
        : '내려받은 내용을 채널에 올렸다면 실제 게시 여부는 채널에서 직접 확인해 주세요.',
    evidenceShown: false,
    actions: [
      { action: manual.method === 'COPY' ? 'COPY_TEXT' : 'DOWNLOAD_IMAGE', label: RESULT_ACTION_LABEL[manual.method === 'COPY' ? 'COPY_TEXT' : 'DOWNLOAD_IMAGE'], channel },
    ],
  }
}

/**
 * VERIFIED 카드를 근거로 검증한다. 어긋나면 UNKNOWN 으로 낮춘다.
 * 어떤 경우에도 CHECKING/UNKNOWN/FAILED 를 VERIFIED 로 올리지 않는다.
 */
function verifiedCard(
  channel: PreviewChannel,
  base: ChannelOutcome,
  evidence: ResultEvidence | undefined,
): ResultChannelCard {
  const url = evidencePermalink(base.permalink)
  if (!url) return unknownCard(channel, '게시 링크를 확인할 수 없어 게시 확인으로 표시하지 않았어요.')

  const at = postedAtLabel(base.verifiedAt)
  if (!at) {
    return unknownCard(channel, '게시 시각 근거를 읽을 수 없어 게시 확인으로 표시하지 않았어요.')
  }

  const account = accountVerdict(evidence)
  if (account.state === 'UNKNOWN') {
    return unknownCard(channel, '게시 대상 계정을 확인할 수 없어 직접 확인해 주세요.')
  }
  if (account.state === 'MISMATCH') {
    return unknownCard(channel, '승인한 계정이 아닌 곳에서 게시물이 확인됐어요. 직접 확인해 주세요.')
  }

  return {
    channel,
    name: CHANNEL_NAME[channel],
    state: 'VERIFIED',
    label: `${CHANNEL_NAME[channel]} 게시 확인`,
    detail: base.detail,
    permalink: url,
    postedAtLabel: at,
    accountLabel: account.label ?? undefined,
    retryAllowed: false,
    evidenceShown: true,
    actions: [{ action: 'OPEN_POST', label: RESULT_ACTION_LABEL.OPEN_POST, href: url, channel }],
  }
}

function failedCard(channel: PreviewChannel, base: ChannelOutcome): ResultChannelCard {
  return {
    channel,
    name: CHANNEL_NAME[channel],
    state: 'FAILED',
    label: `${CHANNEL_NAME[channel]} 게시 실패`,
    detail: base.detail,
    retryAllowed: base.canRetry,
    evidenceShown: false,
    actions: base.canRetry
      ? [{ action: 'RETRY', label: RESULT_ACTION_LABEL.RETRY, channel }]
      : [],
  }
}

function cardFor(
  channel: PreviewChannel,
  base: ChannelOutcome,
  input: ResultScreenInput,
): ResultChannelCard {
  const manual = input.manual?.[channel]
  if (base.state === 'VERIFIED') {
    return verifiedCard(channel, base, input.evidence?.[channel])
  }
  // 게시가 확인되지 않은 채널에 수동 전달 기록이 있으면 '직접 전달'로만 표시한다.
  if (manual) return manualCard(channel, manual)
  if (base.state === 'CHECKING') return checkingCard(channel, base)
  if (base.state === 'UNKNOWN') return unknownCard(channel, base.detail)
  return failedCard(channel, base)
}

/* ------------------------------------------------------------------ */
/* 전체 화면                                                          */
/* ------------------------------------------------------------------ */

function titleFor(cards: readonly ResultChannelCard[]): string {
  if (cards.length === 0) return '아직 게시 결과가 없어요'
  if (cards.every((card) => card.state === 'VERIFIED')) return '게시를 확인했어요'
  if (cards.some((card) => card.state === 'VERIFIED')) return '일부 채널만 게시를 확인했어요'
  if (cards.some((card) => card.state === 'UNKNOWN')) return '게시 결과를 확인하지 못했어요'
  if (cards.some((card) => card.state === 'CHECKING')) return '외부 확인 중이에요'
  if (cards.some((card) => card.state === 'MANUAL')) return '직접 전달한 내용이에요'
  return '게시하지 못했어요'
}

function actionsFor(cards: readonly ResultChannelCard[]): {
  primaryAction: ResultActionItem | null
  secondaryAction: ResultActionItem | null
  customerLink: { label: string; href: string } | null
} {
  const nextPost: ResultActionItem = {
    action: 'NEXT_POST',
    label: RESULT_ACTION_LABEL.NEXT_POST,
  }
  const retryable = cards.find((card) => card.retryAllowed)
  if (retryable) {
    return {
      primaryAction: { action: 'RETRY', label: RESULT_ACTION_LABEL.RETRY, channel: retryable.channel },
      secondaryAction: nextPost,
      customerLink: null,
    }
  }
  const allVerified = cards.length > 0 && cards.every((card) => card.state === 'VERIFIED')
  if (allVerified) {
    const first = cards.find((card) => card.permalink)
    return {
      primaryAction: nextPost,
      secondaryAction: first?.permalink
        ? {
            action: 'VIEW_CUSTOMER_LINK',
            label: RESULT_ACTION_LABEL.VIEW_CUSTOMER_LINK,
            href: first.permalink,
            channel: first.channel,
          }
        : null,
      customerLink: first?.permalink
        ? { label: RESULT_ACTION_LABEL.VIEW_CUSTOMER_LINK, href: first.permalink }
        : null,
    }
  }
  // 확인 중·확인 불가·수동 전달: 재게시가 아니라 결과 재조회/직접 확인이 먼저다.
  return {
    primaryAction: { action: 'REFRESH', label: RESULT_ACTION_LABEL.REFRESH },
    secondaryAction: nextPost,
    customerLink: null,
  }
}

/**
 * 첫 가치 이벤트는 모든 표시 채널이 VERIFIED 일 때만 만든다.
 * 시각은 서버 readback 의 verifiedAt 중 가장 이른 값이다.
 */
function firstValueEventFor(
  cards: readonly ResultChannelCard[],
  outcome: FirstPostOutcome,
): FirstValueEvent | null {
  if (cards.length === 0) return null
  if (!cards.every((card) => card.state === 'VERIFIED')) return null
  const verified: { channel: PreviewChannel; at: string; ms: number }[] = []
  for (const card of cards) {
    const raw = outcome.channels[card.channel]?.verifiedAt
    if (!raw) return null
    const ms = Date.parse(raw)
    if (Number.isNaN(ms)) return null
    verified.push({ channel: card.channel, at: raw, ms })
  }
  if (verified.length === 0) return null
  const earliest = verified.reduce((min, item) => (item.ms < min.ms ? item : min))
  return {
    event: 'FIRST_VALUE_DELIVERED',
    at: earliest.at,
    source: 'PROVIDER_READBACK',
    channels: PREVIEW_CHANNELS.filter((channel) => verified.some((item) => item.channel === channel)),
  }
}

export function buildResultScreen(input: ResultScreenInput): ResultScreen {
  const cards: ResultChannelCard[] = []
  for (const channel of PREVIEW_CHANNELS) {
    const base = input.outcome.channels[channel]
    if (!base) continue
    cards.push(cardFor(channel, base, input))
  }

  const celebrate = cards.length > 0 && cards.every((card) => card.state === 'VERIFIED')
  const firstValueEvent = celebrate ? firstValueEventFor(cards, input.outcome) : null
  const { primaryAction, secondaryAction, customerLink } = actionsFor(cards)
  const hasManual = cards.some((card) => card.state === 'MANUAL')

  return {
    title: titleFor(cards),
    overall: input.outcome.overall,
    celebrate,
    completionToast: celebrate ? '첫 게시를 확인했어요' : null,
    cards,
    primaryAction,
    secondaryAction,
    customerLink,
    firstValueEvent,
    pendingNote:
      cards.some((card) => card.state === 'CHECKING') || cards.some((card) => card.state === 'UNKNOWN')
        ? '아직 게시가 확인되지 않았어요. 확인 전에는 같은 내용을 다시 올리지 마세요.'
        : null,
    manualNotice: hasManual
      ? '직접 전달한 내용은 외부 게시 확인 전이에요. 채널에서 실제 게시 여부를 직접 확인해 주세요.'
      : null,
  }
}
