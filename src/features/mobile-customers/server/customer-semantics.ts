import type { ConsentStatus, ContactChannel, CustomerSegment } from '../customer-model'

/**
 * 고객(M17) 데이터 의미 정의 (ANI-1771).
 *
 * 고객 마스터 테이블은 아직 없다. 지금 확인 가능한 원천은 두 가지뿐이다.
 *   - customer_conversations : 상담 요약 행. 채널 식별자는 해시뿐이고 전화번호·이메일 같은 연락처 컬럼이 없다.
 *   - customer_opt_outs      : 수신거부/삭제 요청 원장. (workspace_id, customer_id) 당 1행.
 *
 * 그래서 화면이 요구하는 값은 다음처럼 도출한다. 근거 없는 값은 항상 fail-closed 쪽으로 둔다.
 *
 * 수신 동의(consent)
 *   - withdrawn : 같은 workspace 의 customer_opt_outs 에 같은 customer_id 행이 있다.
 *   - granted   : 현재 스키마에는 '동의했다'는 적극 근거를 저장하는 곳이 없다. 따라서 절대 도출하지 않는다.
 *                 (수신거부 행이 없다는 사실은 동의가 아니다.)
 *   - unknown   : 그 외 전부. customer_id 가 비어 있어 원장과 대조할 수 없는 경우 포함.
 *   → 결과적으로 이 API 의 고객은 granted 가 없고, 캠페인 대상(campaignAudience)은 비어 있다. 의도된 동작이다.
 *     동의 근거 저장소(별도 이슈)가 생기면 이 파일의 deriveConsent 만 확장한다.
 *
 * 인증된 연락처(verifiedContacts)
 *   - 연락처 원천(검증 상태 포함)이 없으므로 항상 빈 배열. 연락 CTA 는 전부 비활성으로 보인다.
 *   - 연락처 값(전화번호·이메일)은 이 API 가 읽지도, 내려보내지도 않는다.
 *
 * 구분(segment)
 *   - 상담 행만 알 수 있으므로 모두 'inquiring'. 예약/방문 단계는 예약 원장 연결 전까지 단정하지 않는다.
 */

export interface OptOutRow { customer_id: unknown; opted_out_at: unknown; source: unknown }

export interface DerivedConsent {
  status: ConsentStatus
  checkedAt: string | null
  /** 사용자에게 보여줄 출처 라벨. 내부 코드를 그대로 노출하지 않는다. */
  source: string | null
}

const OPT_OUT_SOURCE_LABEL: Record<string, string> = {
  customer_request: '고객 요청',
  manual: '직접 등록',
  provider_webhook: '채널 알림',
  legal: '법적 요청',
}

export function deriveConsent(customerId: unknown, optOuts: Map<string, OptOutRow>): DerivedConsent {
  if (typeof customerId !== 'string' || customerId.length === 0) return { status: 'unknown', checkedAt: null, source: null }
  const hit = optOuts.get(customerId)
  if (!hit) return { status: 'unknown', checkedAt: null, source: null }
  const at = typeof hit.opted_out_at === 'string' && !Number.isNaN(Date.parse(hit.opted_out_at)) ? new Date(hit.opted_out_at).toISOString() : null
  const source = typeof hit.source === 'string' ? OPT_OUT_SOURCE_LABEL[hit.source] ?? null : null
  return { status: 'withdrawn', checkedAt: at, source }
}

export function deriveVerifiedContacts(): ContactChannel[] {
  return []
}

export function deriveSegment(): CustomerSegment {
  return 'inquiring'
}

const CHANNEL_LABEL: Record<string, string> = {
  instagram: '인스타그램',
  threads: '스레드',
  naver_blog: '네이버 블로그',
  naver_place: '네이버 플레이스',
}
export const channelLabel = (channel: unknown) => (typeof channel === 'string' ? CHANNEL_LABEL[channel] ?? null : null)

const STATUS_LABEL: Record<string, string> = {
  open: '상담 진행 중',
  needs_attention: '확인이 필요한 상담',
  waiting_customer: '고객 답변 대기',
  resolved: '상담 완료',
  archived: '보관된 상담',
}
export const statusLabel = (status: unknown) => (typeof status === 'string' ? STATUS_LABEL[status] ?? null : null)
