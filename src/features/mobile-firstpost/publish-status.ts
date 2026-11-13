/**
 * 게시 상태 표시 모델 — 게시·복사·보관·검증중.
 *
 * 전송 계층 상태(`deliveryStatus`)와 독립 재조회 근거(게시물 주소 + 확인 시각)를 분리한다.
 * `succeeded` 는 채널이 전송을 접수했다는 뜻이며 게시 확인이 아니다. 근거가 없으면
 * '게시 확인'을 만들지 않고 '외부 확인 중'으로 둔다. 어떤 경우에도 확인 중·확인 불가·실패·
 * 수동 전달·보관을 '게시 확인'으로 올리지 않는다(fail-closed).
 *
 * 수동 전달(복사·내려받기)과 보관은 게시가 아니다. 보관 문구는 '발행 준비 완료 · 외부 게시 전'
 * 이며 '예약됨'을 쓰지 않는다.
 */
import type { StatusPillKind } from '@/components/mobile-ui'
import type { ExecutionFailureCause } from './execution-contract'
import { FAILED_COPY } from './publish-outcome'
import { evidencePermalink, postedAtLabel } from './result-screen'

export type PublishDeliveryStatus = 'pending' | 'succeeded' | 'failed' | 'unknown'

export type ManualDeliveryMethod = 'copy' | 'download'

export type PublishStatusState =
  | 'VERIFIED'
  | 'CHECKING'
  | 'UNKNOWN'
  | 'FAILED'
  | 'MANUAL'
  | 'ARCHIVED'

export interface PublishStatusInput {
  /** 전송 계층 상태. 값이 없으면 'unknown' 과 같이 다룬다(성공으로 추정하지 않는다). */
  deliveryStatus?: PublishDeliveryStatus | null
  /** 독립 재조회로 확인된 게시물 주소. 전송 응답의 id 를 여기에 넣지 않는다. */
  readbackUrl?: string | null
  /** 독립 재조회 확인 시각(ISO). 주소와 시각이 모두 있어야 게시 확인이다. */
  verifiedAt?: string | null
  /** 사용자가 직접 복사·내려받기로 전달했다고 표시한 기록. 게시가 아니다. */
  manualDelivery?: ManualDeliveryMethod | null
  /** 보관(발행 준비 완료). 외부 게시 전이며 '예약됨'이 아니다. */
  archived?: boolean
  /** 실패 원인. 없으면 UNSPECIFIED 로 다룬다. */
  failureCause?: ExecutionFailureCause | null
}

export interface PublishStatus {
  state: PublishStatusState
  kind: StatusPillKind
  label: string
  detail: string
  /** 재게시·재시도를 열어도 되는가. 확인 중·확인 불가·수동 전달·보관은 중복 위험이 있어 false. */
  retryAllowed: boolean
  /** 독립 재조회로 확인된 게시물 주소. VERIFIED 일 때만 값이 있다. */
  permalink: string | null
}

const UNKNOWN_STATUS: PublishStatus = {
  state: 'UNKNOWN',
  kind: 'review',
  label: '결과 확인 불가',
  detail: '게시 결과를 확인할 수 없어요. 채널에서 직접 확인해 주세요.',
  retryAllowed: false,
  permalink: null,
}

/**
 * 게시 기록 하나를 공통 상태 어휘로 옮긴다.
 *
 * 우선순위: 재조회 근거 > 수동 전달 > 실패 > 전송 중 > 전송 접수 > 확인 불가 > 보관.
 * 전송이 있었다면 보관보다 전송 상태를 먼저 보여 준다(보내진 기록을 '발행 전'으로 감추지 않는다).
 */
export function publishStatusFor(input: PublishStatusInput): PublishStatus {
  const readbackUrl = evidencePermalink(input.readbackUrl)
  const verifiedAt = postedAtLabel(input.verifiedAt)
  if (readbackUrl && verifiedAt) {
    return {
      state: 'VERIFIED',
      kind: 'verified',
      label: '게시 확인',
      detail: '채널 게시물을 다시 불러와 확인했어요.',
      retryAllowed: false,
      permalink: readbackUrl,
    }
  }

  if (input.manualDelivery) {
    return {
      state: 'MANUAL',
      kind: 'draft',
      label: '직접 전달',
      detail: input.manualDelivery === 'copy'
        ? '복사한 내용을 채널에 올렸다면 실제 게시 여부는 채널에서 직접 확인해 주세요.'
        : '내려받은 내용을 채널에 올렸다면 실제 게시 여부는 채널에서 직접 확인해 주세요.',
      retryAllowed: false,
      permalink: null,
    }
  }

  if (input.deliveryStatus === 'failed') {
    const copy = FAILED_COPY[input.failureCause ?? 'UNSPECIFIED']
    return {
      state: 'FAILED',
      kind: 'action_needed',
      label: '게시 실패',
      detail: copy.detail,
      retryAllowed: copy.canRetry,
      permalink: null,
    }
  }

  if (input.deliveryStatus === 'pending') {
    return {
      state: 'CHECKING',
      kind: 'checking_external',
      label: '전송 중',
      detail: '채널로 보내는 중이에요. 끝나면 결과를 다시 확인할게요.',
      retryAllowed: false,
      permalink: null,
    }
  }

  if (input.deliveryStatus === 'succeeded') {
    // 전송 접수 ≠ 게시 확인. 주소를 다시 읽어 오기 전에는 확인 중으로 둔다.
    return {
      state: 'CHECKING',
      kind: 'checking_external',
      label: '외부 확인 중',
      detail: '전송은 접수됐지만 채널의 게시물 주소를 아직 확인하지 못했어요. 다시 올리지 말고 결과를 다시 확인해 주세요.',
      retryAllowed: false,
      permalink: null,
    }
  }

  if (input.deliveryStatus === 'unknown') return UNKNOWN_STATUS

  if (input.archived) {
    return {
      state: 'ARCHIVED',
      kind: 'draft',
      label: '발행 준비 완료 · 외부 게시 전',
      detail: '보관했어요. 외부 채널에는 아직 올리지 않았어요.',
      retryAllowed: false,
      permalink: null,
    }
  }

  return UNKNOWN_STATUS
}
