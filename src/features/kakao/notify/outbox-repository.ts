/**
 * 카카오 알림톡 Outbox 저장소 어댑터 (Outbox Repository Port Implementation)
 *
 * [보안 및 무결성 원칙]
 * 1. PII 노출 방지: 에러 메시지나 body에 전화번호, 이름, 쿼리 덤프 등 개인식별정보(PII) 누출을 영구 차단합니다.
 * 2. Fail-Closed 원칙: 운영 근거 저장소(evidenceReader) 또는 템플릿 심사 리더(templateApprovalReader)가
 *    주입되지 않은 경우 메타데이터나 opt-out 부재를 근거로 동의(granted)를 절대 추정하지 않고 null을 반환합니다.
 * 3. 마이크로초 보존: PostgreSQL timestamptz의 마이크로초 raw string을 Date 변환 없이 그대로 version에 보존하여
 *    CAS 및 Double-Read의 낙관적 락 무결성을 보장합니다.
 * 4. 테넌트 격리 (Cross-Workspace 방어): workspaceId와 reservationId를 조회 조건에 강제하고,
 *    반환된 row의 테넌트 ID가 요청과 불일치할 경우 안전하게 거부(null)합니다.
 * 5. 전화번호 미입력 시 BLOCKED 유도: DB row의 전화번호가 null/undefined인 경우 빈 문자열('')을 반환하여
 *    Outbox Processor에서 INVALID_PHONE으로 안전하게 BLOCKED 되도록 유도합니다.
 */

import type {
  InformationalEvidence,
  NotificationEvent,
  RepositoryPort,
  ReservationSnapshot,
  TemplateApproval,
} from './outbox-processor'

/**
 * DB에서 조회하는 최소 예약 Row 타입
 * PII 확산 방지를 위해 map에 필요한 최소 필드만 정의합니다.
 */
export interface ReservationDbRow {
  id: string
  workspace_id: string
  status: string
  customer_id?: string | null
  customer_name?: string | null
  customer_phone?: string | null
  phone?: string | null
  service_name?: string | null
  cancel_reason?: string | null
  metadata?: Record<string, unknown> | null
  payment_amount_krw?: number | null
  updated_at: string
}

export interface ReservationQueryParams {
  workspaceId: string
  reservationId: string
  event?: NotificationEvent
}

export type ReservationQueryFn = (
  params: ReservationQueryParams,
) => Promise<ReservationDbRow | null>

export interface ReservationReaderPort {
  queryReservation(params: ReservationQueryParams): Promise<ReservationDbRow | null>
}

export type ReservationReader = ReservationQueryFn | ReservationReaderPort

export interface InformationalEvidenceQuery {
  workspaceId: string
  reservationId: string
  phone: string
}

export type InformationalEvidenceReaderFn = (
  query: InformationalEvidenceQuery,
) => Promise<InformationalEvidence | null>

export interface InformationalEvidenceReaderPort {
  getEvidence(query: InformationalEvidenceQuery): Promise<InformationalEvidence | null>
}

export type InformationalEvidenceReader =
  | InformationalEvidenceReaderFn
  | InformationalEvidenceReaderPort
  | null
  | undefined

export type TemplateApprovalReaderFn = (
  event: NotificationEvent,
) => Promise<TemplateApproval | null>

export interface TemplateApprovalReaderPort {
  getApproval(event: NotificationEvent): Promise<TemplateApproval | null>
}

export type TemplateApprovalReader =
  | TemplateApprovalReaderFn
  | TemplateApprovalReaderPort
  | null
  | undefined

export interface OutboxRepositoryDeps {
  reservationReader: ReservationReader
  evidenceReader?: InformationalEvidenceReader
  templateApprovalReader?: TemplateApprovalReader
}

/**
 * 알림톡 Outbox 처리기용 RepositoryPort 구현체
 */
export class OutboxRepository implements RepositoryPort {
  private readonly reservationReader: ReservationReader
  private readonly evidenceReader?: InformationalEvidenceReader
  private readonly templateApprovalReader?: TemplateApprovalReader

  constructor(deps: OutboxRepositoryDeps) {
    this.reservationReader = deps.reservationReader
    this.evidenceReader = deps.evidenceReader
    this.templateApprovalReader = deps.templateApprovalReader
  }

  /**
   * 최신 예약 스냅샷 조회
   * - workspaceId + reservationId 쿼리 파라미터 강제
   * - cross-workspace 데이터 안전 거부
   * - raw microseconds 보존
   * - phone null 시 empty string 반환
   * - payload PII 배제 (serviceName, bookingStartsAt 등 알림톡 템플릿 매핑에 필요한 항목만 추출)
   * - 에러 발생 시 PII가 없는 generic 고정 오류 발생
   */
  async getCurrentReservation(
    workspaceId: string,
    reservationId: string,
    event?: NotificationEvent,
  ): Promise<ReservationSnapshot | null> {
    const wsId = (workspaceId || '').trim()
    const resId = (reservationId || '').trim()

    if (!wsId || !resId) {
      return null
    }

    let row: ReservationDbRow | null = null
    try {
      if (typeof this.reservationReader === 'function') {
        row = await this.reservationReader({ workspaceId: wsId, reservationId: resId, event })
      } else if (
        this.reservationReader &&
        typeof this.reservationReader.queryReservation === 'function'
      ) {
        row = await this.reservationReader.queryReservation({
          workspaceId: wsId,
          reservationId: resId,
          event,
        })
      } else {
        return null
      }
    } catch {
      // 쿼리 에러나 DB 예외 발생 시 PII 노출 방지를 위해 고정된 generic 에러를 던짐 (no body)
      throw new Error('REPOSITORY_READ_FAILED')
    }

    if (!row) {
      return null
    }

    // 테넌트 격리 및 요청 키 일치 검증 (Cross-workspace row reject)
    if (row.workspace_id !== wsId || row.id !== resId) {
      return null
    }

    // 전화번호 추출: 없거나 null인 경우 empty string으로 설정하여 processor에서 BLOCKED(INVALID_PHONE) 유도
    const rawPhone = row.customer_phone ?? row.phone
    const phone = typeof rawPhone === 'string' ? rawPhone.trim() : ''

    // 고객 식별자: customer_id가 없으면 customer_name 사용
    const customerId =
      typeof row.customer_id === 'string' && row.customer_id.trim()
        ? row.customer_id.trim()
        : typeof row.customer_name === 'string' && row.customer_name.trim()
          ? row.customer_name.trim()
          : ''

    // payload: 알림톡 템플릿 변수 치환에 필요한 필드만 엄격 선별 (PII 불필요 복제 금지)
    const payload: Record<string, unknown> = {}
    if (typeof row.customer_name === 'string' && row.customer_name.trim()) {
      payload.customerName = row.customer_name.trim()
    }
    if (row.service_name) {
      payload.serviceName = row.service_name
    }
    if (row.metadata && typeof row.metadata === 'object') {
      const meta = row.metadata as Record<string, unknown>
      if (meta.requestDeclined === true) {
        payload.requestDeclined = true
      }
      // [신뢰 한계] metadata의 bookingStartsAt, previousBookingStartsAt 등은 사장/시스템 기록값(신뢰 한계 존재)이며
      // 알림톡 템플릿 변수 매핑을 위해 문자열 타입만 엄격히 추출합니다.
      if (typeof meta.bookingStartsAt === 'string') {
        payload.bookingStartsAt = meta.bookingStartsAt
      } else if (typeof meta.startsAt === 'string') {
        payload.bookingStartsAt = meta.startsAt
      }
      if (typeof meta.shopName === 'string') {
        payload.shopName = meta.shopName
      }
      if (typeof meta.locationText === 'string') {
        payload.locationText = meta.locationText
      }
      if (
        typeof meta.previousBookingStartsAt === 'string' &&
        meta.previousBookingStartsAt.trim()
      ) {
        payload.previousStartsAt = meta.previousBookingStartsAt.trim()
      } else if (typeof meta.previousStartsAt === 'string' && meta.previousStartsAt.trim()) {
        payload.previousStartsAt = meta.previousStartsAt.trim()
      } else if (typeof meta.priorStartsAt === 'string' && meta.priorStartsAt.trim()) {
        payload.previousStartsAt = meta.priorStartsAt.trim()
      }
      if (typeof meta.refundInfo === 'string' && meta.refundInfo.trim()) {
        payload.refundInfo = meta.refundInfo.trim()
      } else if (typeof meta.refundNotice === 'string' && meta.refundNotice.trim()) {
        payload.refundInfo = meta.refundNotice.trim()
      }
      if (typeof meta.paymentInfo === 'string' && meta.paymentInfo.trim()) {
        payload.paymentInfo = meta.paymentInfo.trim()
      } else if (typeof meta.paymentStatus === 'string' && meta.paymentStatus.trim()) {
        payload.paymentInfo = meta.paymentStatus.trim()
      }
    }

    // 결제금액: payment_captures 연동 row.payment_amount_krw 채택 (deposit_krw 단독 추정 금지)
    if (typeof row.payment_amount_krw === 'number' && Number.isFinite(row.payment_amount_krw)) {
      payload.paymentAmountKrw = row.payment_amount_krw
    } else if (row.metadata && typeof row.metadata === 'object') {
      const meta = row.metadata as Record<string, unknown>
      if (typeof meta.paymentAmountKrw === 'number' && Number.isFinite(meta.paymentAmountKrw)) {
        payload.paymentAmountKrw = meta.paymentAmountKrw
      }
    }

    // 취소 사유: DB 실제 컬럼 cancel_reason 우선, 없으면 metadata.cancelReason 대체, blank면 미포함
    const dbCancelReason =
      typeof row.cancel_reason === 'string' ? row.cancel_reason.trim() : ''
    if (dbCancelReason) {
      payload.cancelReason = dbCancelReason
    } else if (row.metadata && typeof row.metadata === 'object') {
      const meta = row.metadata as Record<string, unknown>
      if (typeof meta.cancelReason === 'string' && meta.cancelReason.trim()) {
        payload.cancelReason = meta.cancelReason.trim()
      }
    }

    return {
      workspaceId: row.workspace_id,
      reservationId: row.id,
      // raw microseconds 문자열 유지 (Date 파싱/절삭 금지)
      version: row.updated_at,
      status: row.status,
      customerId,
      phone,
      payload: Object.keys(payload).length > 0 ? payload : undefined,
    }
  }

  /**
   * 정보성 알림 수신 근거(동의) 조회
   * - 운영근거저장소(evidenceReader) 주입이 없으면 null 반환 (fail-closed, 절대 메타데이터/opt-out 부재로 추정 금지)
   * - customerId가 이름일 수 있으므로 reservationId + workspaceId + phone 필수 바인딩
   * - 에러 발생 시 PII 없는 generic 고정 오류 발생
   */
  async getInformationalEvidence(
    snapshot: ReservationSnapshot,
  ): Promise<InformationalEvidence | null> {
    if (!this.evidenceReader) {
      return null
    }

    const query: InformationalEvidenceQuery = {
      workspaceId: snapshot.workspaceId,
      reservationId: snapshot.reservationId,
      phone: snapshot.phone,
    }

    try {
      if (typeof this.evidenceReader === 'function') {
        return await this.evidenceReader(query)
      }
      if (typeof this.evidenceReader.getEvidence === 'function') {
        return await this.evidenceReader.getEvidence(query)
      }
      return null
    } catch {
      throw new Error('EVIDENCE_READ_FAILED')
    }
  }

  /**
   * 알림톡 템플릿 심사 승인 여부 조회
   * - template approval reader 주입이 없으면 null 반환
   * - 에러 발생 시 generic 고정 오류 발생
   */
  async getTemplateApproval(event: NotificationEvent): Promise<TemplateApproval | null> {
    if (!this.templateApprovalReader) {
      return null
    }

    try {
      if (typeof this.templateApprovalReader === 'function') {
        return await this.templateApprovalReader(event)
      }
      if (typeof this.templateApprovalReader.getApproval === 'function') {
        return await this.templateApprovalReader.getApproval(event)
      }
      return null
    } catch {
      throw new Error('TEMPLATE_APPROVAL_READ_FAILED')
    }
  }
}

/**
 * OutboxRepository 팩토리 함수
 */
export function createOutboxRepository(deps: OutboxRepositoryDeps): OutboxRepository {
  return new OutboxRepository(deps)
}
