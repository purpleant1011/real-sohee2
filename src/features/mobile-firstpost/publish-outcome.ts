/**
 * 첫 포스팅 게시 결과 → 사용자 표시 모델 (ANI-1681, M08).
 * 전송 / Provider 수락 / 독립 재조회(verified)를 분리한다.
 * 서버 overallStatus는 참고만 하고, 채널별 영수증 근거(permalink + verifiedAt)가 없으면 VERIFIED로 올리지 않는다.
 *
 * W6 실행 상태는 `execution-contract.ts`가 정의하고 `execute-status-adapter.ts`가 단계로 옮긴다.
 * 이 파일은 그 단계와 원인을 사용자 문구로만 바꾼다. 상태를 다시 판정하지 않는다.
 */
import type { ExecuteStatus, ExecutionFailureCause, ExecutionMeta } from './execution-contract'

export type OutcomeChannel = 'instagram' | 'threads'
export type OutcomeStage =
  | 'REQUESTED' | 'EXECUTING' | 'PROVIDER_ACCEPTED' | 'EXTERNALLY_VERIFIED'
  | 'OUTCOME_OBSERVED' | 'FAILED' | 'RESULT_UNKNOWN'

export interface OutcomeReceipt {
  channel: OutcomeChannel
  stage: OutcomeStage
  providerPostId?: string
  permalink?: string
  verifiedAt?: string
  errorMessage?: string
  /** W6 실행 상태 원본. 표시는 stage로만 정하고 이 값은 진단용으로 보존한다. */
  executeStatus?: ExecuteStatus
  /** MANUAL_REQUIRED 원인. 표시 문구 분기에만 쓰고 코드 자체는 화면에 내보내지 않는다. */
  failureCause?: ExecutionFailureCause
  /** 서버가 준 전송/재조회 메타데이터. 없으면 만들지 않는다. */
  meta?: ExecutionMeta
}
export interface OutcomeInput {
  overallStatus: 'ALL_VERIFIED' | 'PARTIAL_SUCCESS' | 'FAILED'
  receipts: Partial<Record<OutcomeChannel, OutcomeReceipt>>
}

export type ChannelState = 'VERIFIED' | 'CHECKING' | 'UNKNOWN' | 'FAILED'
export type OverallState = 'VERIFIED' | 'PARTIAL' | 'CHECKING' | 'UNKNOWN' | 'FAILED' | 'NOT_STARTED'

export interface ChannelOutcome {
  state: ChannelState
  label: string
  detail: string
  permalink?: string
  verifiedAt?: string
  canRetry: boolean
}
export interface FirstPostOutcome {
  overall: OverallState
  headline: string
  celebrate: boolean
  channels: Partial<Record<OutcomeChannel, ChannelOutcome>>
}

const CHANNEL_NAME: Record<OutcomeChannel, string> = { instagram: '인스타그램', threads: '스레드' }

/**
 * MANUAL_REQUIRED 원인별 표시. 원인 코드는 화면에 내보내지 않고 문구로만 바꾼다.
 * READBACK_UNKNOWN은 "이미 올라갔을 수 있음"이므로 재시도를 열지 않는다(중복 게시 방지).
 * 원인이 없거나 알 수 없으면 재시도 가능한 기본 문구로 내리되, 성공으로 표현하지는 않는다.
 */
export const FAILED_COPY: Record<ExecutionFailureCause, { detail: string; canRetry: boolean }> = {
  PROVIDER_REJECTED: {
    detail: '게시를 요청했지만 채널에서 받아들이지 않았어요. 연결 상태를 확인한 뒤 다시 시도할 수 있어요.',
    canRetry: true,
  },
  TRANSPORT_FAILED: {
    detail: '게시 요청이 채널에 전달되지 않았어요. 잠시 뒤 다시 시도할 수 있어요.',
    canRetry: true,
  },
  READBACK_UNKNOWN: {
    detail: '게시 요청은 보냈지만 실제 게시 여부를 확인하지 못했어요. 다시 올리면 중복될 수 있어 직접 확인해 주세요.',
    canRetry: false,
  },
  UNSPECIFIED: {
    detail: '게시하지 못했어요. 연결 상태를 확인한 뒤 다시 시도할 수 있어요.',
    canRetry: true,
  },
}

function failedOutcome(name: string, cause?: ExecutionFailureCause): ChannelOutcome {
  const copy = FAILED_COPY[cause ?? 'UNSPECIFIED']
  return { state: 'FAILED', label: `${name} 게시 실패`, detail: copy.detail, canRetry: copy.canRetry }
}

function channelOutcome(r: OutcomeReceipt): ChannelOutcome {
  const name = CHANNEL_NAME[r.channel]
  const isVerifiedStage = r.stage === 'EXTERNALLY_VERIFIED' || r.stage === 'OUTCOME_OBSERVED'
  if (isVerifiedStage && r.permalink && r.verifiedAt) {
    return { state: 'VERIFIED', label: `${name} 게시 확인`, detail: '실제 게시물을 다시 불러와 확인했어요.', permalink: r.permalink, verifiedAt: r.verifiedAt, canRetry: false }
  }
  if (r.stage === 'RESULT_UNKNOWN') {
    return { state: 'UNKNOWN', label: `${name} 결과 확인 불가`, detail: '게시됐는지 아직 알 수 없어요. 다시 올리면 중복될 수 있어 직접 확인해 주세요.', canRetry: false }
  }
  if (r.stage === 'FAILED') {
    return failedOutcome(name, r.failureCause)
  }
  // REQUESTED / EXECUTING / PROVIDER_ACCEPTED, 또는 검증 단계지만 근거(permalink/시각)가 없는 경우
  return { state: 'CHECKING', label: `${name} 외부 확인 중`, detail: '게시 요청은 받아들여졌어요. 실제로 올라갔는지 확인하는 중이에요.', canRetry: false }
}

export function deriveFirstPostOutcome(input: OutcomeInput): FirstPostOutcome {
  const channels: FirstPostOutcome['channels'] = {}
  for (const key of ['instagram', 'threads'] as const) {
    const r = input.receipts[key]
    if (r) channels[key] = channelOutcome(r)
  }
  const states = Object.values(channels).map((c) => c!.state)
  let overall: OverallState
  if (states.length === 0) overall = 'NOT_STARTED'
  else if (states.every((s) => s === 'VERIFIED')) overall = 'VERIFIED'
  else if (states.includes('UNKNOWN')) overall = 'UNKNOWN'
  else if (states.includes('VERIFIED')) overall = 'PARTIAL'
  else if (states.includes('CHECKING')) overall = 'CHECKING'
  else overall = 'FAILED'

  const headline: Record<OverallState, string> = {
    VERIFIED: '게시를 확인했어요',
    PARTIAL: '일부 채널만 게시를 확인했어요',
    CHECKING: '외부 확인 중이에요',
    UNKNOWN: '게시 결과를 확인하지 못했어요',
    FAILED: '게시하지 못했어요',
    NOT_STARTED: '아직 게시 요청 전이에요',
  }
  return { overall, headline: headline[overall], celebrate: overall === 'VERIFIED', channels }
}
