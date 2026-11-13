/**
 * M07 게시 전 최종 승인 (ANI-1680).
 *
 * 정본: `docs/mobile-r2/01-onboarding-creative-chat.md` §M07
 *       `docs/mobile-r2/00-product-ia-and-baseline.md` M07
 *       `docs/mobile-r2/05-390px-wireframes-and-ui-state-matrix.md` §3
 *
 * 이 파일이 지키는 경계:
 * - 승인 화면은 "어디에(채널·계정) → 무엇을(사진+전문) → 비용"을 한 화면에 보여주고,
 *   고정 CTA 는 `이 내용으로 게시 요청` 하나다.
 * - 승인 가능 판정은 fail-closed 다. 게시 권한·사진 사용 확인·예상 비용·저장 상태·
 *   서버 승인 지문 중 하나라도 확인되지 않으면 CTA 를 열지 않는다.
 * - 승인 스냅샷은 사용자가 화면에서 본 그대로(원문 공백·줄바꿈 무변형, 사진 id 포함)다.
 *   승인 뒤 원고나 사진이 바뀌면 `STALE` 이며 다시 승인해야 한다.
 * - 서버 승인 지문(`serverFingerprint`)은 화면에서 다시 계산하지 않는다. 서버가 준 값을
 *   그대로 전달하며, 승인 시점 스냅샷과 서버 지문이 어긋나면 보내지 않고 다시 불러오게 한다.
 * - 같은 CTA 연속 클릭은 요청 1건이다. 클릭 시점에 화면 상태를 다시 읽어 재검증한다.
 * - '승인함'은 '게시됨'이 아니다. 이 파일은 게시 결과를 만들지 않는다(M08 `publish-outcome.ts`).
 *
 * 네트워크를 모른다. 승인 API 호출은 호출 측이 주입한다.
 */
import { APPROVAL_PHRASE, createSingleFlight, isApprovalStale } from './approval-gate'
import {
  CHANNEL_NAME,
  MANUAL_FALLBACK_ACTIONS,
  PREVIEW_CHANNELS,
  connectionBadge,
  toChannelCapability,
  type ChannelConnection,
  type PreviewAction,
  type PreviewChannel,
  type PublishPermission,
} from './preview-set'

/** 승인 화면의 고정 CTA. 승인 성공 문구가 아니다. */
export const APPROVAL_CTA = '이 내용으로 게시 요청'

/** 서버 예약 게시 계약이 확인되지 않아 M07 은 '지금 게시'만 승인한다. */
export const APPROVAL_TIMING_LABEL = '지금 바로 게시'

/* ------------------------------------------------------------------ */
/* 입력                                                               */
/* ------------------------------------------------------------------ */

export interface ApprovalTarget {
  channel: PreviewChannel
  /** 게시 대상 계정 핸들. 비어 있으면 대상이 확인되지 않은 것이다. */
  handle: string
  connection: ChannelConnection
  publishPermission: PublishPermission
}

export interface ApprovalCopy {
  channel: PreviewChannel
  /** 화면에 보이는 원문 그대로. 공백·줄바꿈을 정규화하지 않는다. */
  text: string
  cta: string
}

export type RightsEvidence = 'CONFIRMED' | 'UNCONFIRMED'

export type CostSource = 'SERVER_QUOTE' | 'POLICY' | 'UNKNOWN'

/** 예상 비용 스냅샷. 출처가 없거나 값이 확정되지 않으면 `UNKNOWN` 이다. */
export interface ApprovalCost {
  amountKrw: number | null
  source: CostSource
}

/**
 * 실행 표면. 모바일에서 실행 가능한지 확인되지 않았으면 승인을 열지 않는다.
 * (PC 전용 실행기 의존은 수동 경로 안내로 대체한다.)
 */
export type ExecutionSurface = 'MOBILE_OK' | 'DESKTOP_ONLY' | 'UNKNOWN'

/** 승인 시점에 고정한 스냅샷. `contentKey` 는 화면이 본 내용, `fingerprint` 는 서버 값이다. */
export interface ApprovalBinding {
  fingerprint: string
  contentKey: string
}

export interface ApprovalReviewInput {
  workspaceName: string
  targets: readonly ApprovalTarget[]
  copies: readonly ApprovalCopy[]
  imageIds: readonly string[]
  rights: RightsEvidence
  /** 화면 원고가 서버에 저장 완료됐는가. 저장 전에는 승인하지 않는다. */
  saved: boolean
  cost: ApprovalCost
  executionSurface: ExecutionSurface
  /** 서버가 초안과 함께 발급한 승인 지문. 없으면 승인 요청을 만들 수 없다. */
  serverFingerprint: string | null
  /** 이미 승인한 스냅샷. 없으면 아직 승인 전이다. */
  approved: ApprovalBinding | null
}

/* ------------------------------------------------------------------ */
/* 승인 스냅샷 키 — 화면이 본 내용 그대로                             */
/* ------------------------------------------------------------------ */

function channelIndex(channel: PreviewChannel): number {
  return PREVIEW_CHANNELS.indexOf(channel)
}

function compareHandles(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * 화면 스냅샷 키. 채널·계정·원고·CTA·사진 id·사진 사용 확인을 담는다.
 *
 * 채널은 고정 순서, 사진 id 는 정렬해 순서만 바뀐 경우를 승인 변경으로 보지 않는다
 * (서버 지문도 사진 id 를 정렬한다). 원고 원문은 자르거나 정규화하지 않는다.
 * 서버 승인 지문과 다른 값이며, 이 키는 "승인한 화면과 지금 화면이 같은가"만 판정한다.
 */
export function approvalContentKey(
  input: Pick<ApprovalReviewInput, 'workspaceName' | 'targets' | 'copies' | 'imageIds' | 'rights'>,
): string {
  const targets = [...input.targets]
    .sort(
      (a, b) =>
        channelIndex(a.channel) - channelIndex(b.channel) || compareHandles(a.handle, b.handle),
    )
    .map((target) => [target.channel, target.handle])

  const copies: Array<[PreviewChannel, string, string]> = []
  for (const channel of PREVIEW_CHANNELS) {
    const copy = input.copies.find((entry) => entry.channel === channel)
    if (copy) copies.push([channel, copy.text, copy.cta])
  }

  return JSON.stringify({
    workspaceName: input.workspaceName,
    targets,
    copies,
    imageIds: [...input.imageIds].sort(),
    rights: input.rights,
  })
}

/* ------------------------------------------------------------------ */
/* 예상 비용                                                          */
/* ------------------------------------------------------------------ */

/** 확정된 정수 원화 금액만 인정한다. 그 외에는 null(fail-closed). */
export function knownCostKrw(cost: ApprovalCost): number | null {
  if (cost.source === 'UNKNOWN') return null
  const amount = cost.amountKrw
  if (amount === null || !Number.isInteger(amount) || amount < 0) return null
  return amount
}

const COST_SOURCE_LABEL: Record<Exclude<CostSource, 'UNKNOWN'>, string> = {
  SERVER_QUOTE: '서버 견적 기준',
  POLICY: '요금 정책 기준',
}

export interface CostView {
  known: boolean
  amountKrw: number | null
  label: string
  detail: string
}

export function costView(cost: ApprovalCost): CostView {
  const amount = knownCostKrw(cost)
  if (amount === null) {
    return {
      known: false,
      amountKrw: null,
      label: '예상 비용 확인 중',
      detail: '비용을 확인하기 전에는 게시 요청을 보낼 수 없어요.',
    }
  }
  const source = cost.source === 'UNKNOWN' ? 'SERVER_QUOTE' : cost.source
  return {
    known: true,
    amountKrw: amount,
    label: '기본 플랜 포함',
    detail: COST_SOURCE_LABEL[source],
  }
}

/* ------------------------------------------------------------------ */
/* 승인 차단 사유 — fail-closed                                       */
/* ------------------------------------------------------------------ */

export type ApprovalBlocker =
  | 'NO_CHANNEL'
  | 'MISSING_ACCOUNT'
  | 'CHANNEL_NOT_PUBLISHABLE'
  | 'NO_COPY'
  | 'NO_CTA'
  | 'NO_IMAGE'
  | 'RIGHTS_UNCONFIRMED'
  | 'COPY_NOT_SAVED'
  | 'COST_UNKNOWN'
  | 'EXECUTION_DESKTOP_ONLY'
  | 'EXECUTION_UNKNOWN'
  | 'FINGERPRINT_MISSING'
  | 'APPROVED_SNAPSHOT_MISMATCH'

export const APPROVAL_BLOCKER_MESSAGE: Record<ApprovalBlocker, string> = {
  NO_CHANNEL: '게시할 채널을 하나 골라주세요.',
  MISSING_ACCOUNT: '게시할 계정을 확인하지 못했어요.',
  CHANNEL_NOT_PUBLISHABLE: '채널 연결과 게시 권한을 먼저 확인해 주세요.',
  NO_COPY: '올릴 문구가 비어 있어요.',
  NO_CTA: '안내 문구가 비어 있어요.',
  NO_IMAGE: '올릴 사진을 한 장 골라주세요.',
  RIGHTS_UNCONFIRMED: '사진 사용 확인이 끝나지 않았어요.',
  COPY_NOT_SAVED: '문구 저장이 끝난 뒤에 승인할 수 있어요.',
  COST_UNKNOWN: '예상 비용을 확인하지 못했어요.',
  EXECUTION_DESKTOP_ONLY: '여기서는 실행할 수 없어요. 컴퓨터에서 진행하거나 직접 올려주세요.',
  EXECUTION_UNKNOWN: '여기서 실행할 수 있는지 확인 중이에요.',
  FINGERPRINT_MISSING: '승인할 내용을 다시 불러와 주세요.',
  APPROVED_SNAPSHOT_MISMATCH: '승인한 내용과 지금 불러온 내용이 달라요. 다시 불러와 주세요.',
}

/** 수동 경로를 안내해야 하는 차단 사유. */
const MANUAL_FALLBACK_BLOCKERS: readonly ApprovalBlocker[] = [
  'CHANNEL_NOT_PUBLISHABLE',
  'EXECUTION_DESKTOP_ONLY',
  'EXECUTION_UNKNOWN',
]

function isPublishable(target: ApprovalTarget): boolean {
  return target.connection === 'CONNECTED' && target.publishPermission === 'GRANTED'
}

/**
 * 승인을 막는 사유 전체. 비어 있어야만 CTA 가 열린다.
 * 이미 승인한 스냅샷과 화면이 같은데 서버 지문만 달라졌다면, 서버 초안이 바뀐
 * 것이므로 승인을 보내지 않고 다시 불러오게 한다(무증거 덮어쓰기 방지).
 */
export function approvalBlockers(input: ApprovalReviewInput): readonly ApprovalBlocker[] {
  const blockers: ApprovalBlocker[] = []

  if (input.targets.length === 0) blockers.push('NO_CHANNEL')
  if (input.targets.some((target) => !target.handle.trim())) blockers.push('MISSING_ACCOUNT')
  if (input.targets.some((target) => !isPublishable(target))) {
    blockers.push('CHANNEL_NOT_PUBLISHABLE')
  }

  const selectedCopies = input.targets.map((target) =>
    input.copies.find((copy) => copy.channel === target.channel),
  )
  if (selectedCopies.some((copy) => !copy || !copy.text.trim())) blockers.push('NO_COPY')
  if (selectedCopies.some((copy) => !copy || !copy.cta.trim())) blockers.push('NO_CTA')

  if (input.imageIds.length === 0 || input.imageIds.some((id) => !id.trim())) {
    blockers.push('NO_IMAGE')
  }
  if (input.rights !== 'CONFIRMED') blockers.push('RIGHTS_UNCONFIRMED')
  if (!input.saved) blockers.push('COPY_NOT_SAVED')
  if (knownCostKrw(input.cost) === null) blockers.push('COST_UNKNOWN')

  if (input.executionSurface === 'DESKTOP_ONLY') blockers.push('EXECUTION_DESKTOP_ONLY')
  else if (input.executionSurface === 'UNKNOWN') blockers.push('EXECUTION_UNKNOWN')

  const serverFingerprint = input.serverFingerprint?.trim()
  if (!serverFingerprint) blockers.push('FINGERPRINT_MISSING')

  if (
    input.approved &&
    serverFingerprint &&
    input.approved.contentKey === approvalContentKey(input) &&
    input.approved.fingerprint !== serverFingerprint
  ) {
    blockers.push('APPROVED_SNAPSHOT_MISMATCH')
  }

  return blockers
}

/* ------------------------------------------------------------------ */
/* 승인 상태 — 승인한 화면과 지금 화면 비교                            */
/* ------------------------------------------------------------------ */

export type ApprovalStatus = 'BEFORE_APPROVAL' | 'CURRENT' | 'STALE'

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  BEFORE_APPROVAL: '승인 전',
  CURRENT: '승인한 내용과 같아요',
  STALE: '승인한 뒤 내용이 바뀌었어요',
}

export function approvalStatusOf(approved: ApprovalBinding | null, contentKey: string): ApprovalStatus {
  if (!approved) return 'BEFORE_APPROVAL'
  return isApprovalStale({
    approvedFingerprint: approved.contentKey,
    currentFingerprint: contentKey,
  })
    ? 'STALE'
    : 'CURRENT'
}

/* ------------------------------------------------------------------ */
/* 화면 모델                                                          */
/* ------------------------------------------------------------------ */

export interface ApprovalTargetView {
  channel: PreviewChannel
  channelName: string
  handle: string
  /** 초록 체크의 유일한 근거 = 연결 확인 + 게시 권한 확인. */
  verified: boolean
  statusLabel: string
}

export interface ApprovalCopyView extends ApprovalCopy {
  channelName: string
}

export interface ApprovalReview {
  contentKey: string
  workspaceName: string
  targets: readonly ApprovalTargetView[]
  /** 전문을 자르지 않는다(펼치기 기본값은 화면 몫). */
  copies: readonly ApprovalCopyView[]
  imageIds: readonly string[]
  cost: CostView
  timingLabel: string
  approvalStatus: ApprovalStatus
  statusLabel: string
  /** 승인 뒤 원고·사진이 바뀌어 재승인이 필요한가. */
  reapprovalRequired: boolean
  blockers: readonly ApprovalBlocker[]
  blockerMessages: readonly string[]
  canApprove: boolean
  ctaLabel: string
  ctaEnabled: boolean
  /** 권한·실행 표면이 막힌 경우의 수동 경로. 그 외에는 비어 있다. */
  manualFallback: readonly PreviewAction[]
}

/** 승인 화면이 그릴 수 있는 값 전부. 게시 상태·성공 문구는 만들지 않는다. */
export function buildApprovalReview(input: ApprovalReviewInput): ApprovalReview {
  const contentKey = approvalContentKey(input)
  const blockers = approvalBlockers(input)

  const targets = input.targets.map((target): ApprovalTargetView => {
    const capability = toChannelCapability({
      channel: target.channel,
      connection: target.connection,
      publishPermission: target.publishPermission,
    })
    const badge = connectionBadge(capability)
    return {
      channel: target.channel,
      channelName: CHANNEL_NAME[target.channel],
      handle: target.handle,
      verified: badge.verified,
      statusLabel: badge.label,
    }
  })

  const copies = input.copies.map(
    (copy): ApprovalCopyView => ({ ...copy, channelName: CHANNEL_NAME[copy.channel] }),
  )

  const manualFallback = blockers.some((blocker) => MANUAL_FALLBACK_BLOCKERS.includes(blocker))
    ? MANUAL_FALLBACK_ACTIONS
    : []

  const approvalStatus = approvalStatusOf(input.approved, contentKey)
  const canApprove = blockers.length === 0

  return {
    contentKey,
    workspaceName: input.workspaceName,
    targets,
    copies,
    imageIds: [...input.imageIds],
    cost: costView(input.cost),
    timingLabel: APPROVAL_TIMING_LABEL,
    approvalStatus,
    statusLabel: APPROVAL_STATUS_LABEL[approvalStatus],
    reapprovalRequired: approvalStatus === 'STALE',
    blockers,
    blockerMessages: blockers.map((blocker) => APPROVAL_BLOCKER_MESSAGE[blocker]),
    canApprove,
    ctaLabel: APPROVAL_CTA,
    ctaEnabled: canApprove,
    manualFallback,
  }
}

/* ------------------------------------------------------------------ */
/* 명시 승인 문구                                                     */
/* ------------------------------------------------------------------ */

/** 서버보다 보수적으로, 앞뒤 공백을 뺀 문구가 정확히 일치해야 한다. */
export function isExplicitApprovalPhrase(value: string): boolean {
  return value.trim() === APPROVAL_PHRASE
}

/* ------------------------------------------------------------------ */
/* 승인 요청 — 클릭 시점 재검증 + single-flight                       */
/* ------------------------------------------------------------------ */

export interface ApprovalSubmission {
  /** 서버가 준 승인 지문. 화면에서 다시 만들지 않는다. */
  serverFingerprint: string
  /** 승인한 화면 스냅샷 키. */
  contentKey: string
  imageIds: readonly string[]
  costKrw: number
  explicitPhrase: string
}

export type ApprovalRunResult<T> =
  | { kind: 'SUBMITTED'; value: T; request: ApprovalSubmission }
  | { kind: 'BLOCKED'; blockers: readonly ApprovalBlocker[]; messages: readonly string[] }
  | { kind: 'PHRASE_REQUIRED' }

/**
 * 승인 요청 1건 보장.
 *
 * - 클릭할 때마다 `read()` 로 화면 상태를 다시 읽어 차단 사유를 재판정한다(실행 직전 재검증).
 * - 진행 중 재클릭은 같은 Promise 를 받고 실제 `submit` 은 1회다.
 * - 실패·완료 뒤에는 잠금이 풀려 다시 시도할 수 있다.
 */
export function createApprovalRequester<T>(deps: {
  read: () => ApprovalReviewInput
  submit: (request: ApprovalSubmission) => Promise<T>
}) {
  let pending: ApprovalSubmission | null = null

  const flight = createSingleFlight<ApprovalRunResult<T>>(async () => {
    const request = pending
    pending = null
    if (!request) {
      return { kind: 'BLOCKED', blockers: [], messages: [] }
    }
    return { kind: 'SUBMITTED', value: await deps.submit(request), request }
  })

  return {
    run(explicitPhrase: string = APPROVAL_PHRASE): Promise<ApprovalRunResult<T>> {
      if (flight.busy) return flight.run()

      if (!isExplicitApprovalPhrase(explicitPhrase)) {
        return Promise.resolve({ kind: 'PHRASE_REQUIRED' })
      }

      const input = deps.read()
      const blockers = approvalBlockers(input)
      const fingerprint = input.serverFingerprint?.trim()
      const costKrw = knownCostKrw(input.cost)

      if (blockers.length > 0 || !fingerprint || costKrw === null) {
        return Promise.resolve({
          kind: 'BLOCKED',
          blockers,
          messages: blockers.map((blocker) => APPROVAL_BLOCKER_MESSAGE[blocker]),
        })
      }

      pending = {
        serverFingerprint: fingerprint,
        contentKey: approvalContentKey(input),
        imageIds: [...input.imageIds],
        costKrw,
        explicitPhrase: APPROVAL_PHRASE,
      }
      return flight.run()
    },
    get busy(): boolean {
      return flight.busy
    },
  }
}
