/**
 * Supabase Notification Outbox Store (RPC Port Implementation)
 *
 * 카카오 알림톡 Outbox 작업을 위한 원자적 RPC 점유·전이·완료 저장소 구현체입니다.
 * - claim: claim_kakao_notification_job RPC 호출을 통한 원자적 리스 점유
 * - markSending: mark_kakao_notification_sending RPC 호출을 통한 발송 직전 CAS 잠금
 * - finish: finish_kakao_notification_job RPC 호출을 통한 최종 상태 전이
 *
 * [보안 및 안정성 철칙]
 * 1. PII 및 Provider 내부 필드(테이블명, 제약조건, 내부 에러 메시지) 노출을 영구 차단합니다.
 * 2. 실패 및 예외 상황에서는 단일 정적 Generic 에러(OutboxStoreError)만을 throw합니다.
 * 3. Boolean 반환값은 data === true에 대해서만 엄격(strict)하게 판정합니다.
 * 4. 자동 재시도 로직을 포함하지 않으며, 단 1회의 원자적 RPC 트랜잭션으로 처리합니다.
 */

import type { StorePort, OutboxState } from './outbox-processor'

export const OUTBOX_STORE_GENERIC_ERROR_MESSAGE = 'Notification outbox store operation failed'

export class OutboxStoreError extends Error {
  constructor(message = OUTBOX_STORE_GENERIC_ERROR_MESSAGE) {
    super(message)
    this.name = 'OutboxStoreError'
  }
}

export interface OutboxRpcResponse<T = unknown> {
  data: T | null
  error: { message: string; code?: string; details?: string; hint?: string } | null
}

/**
 * Supabase RPC 통신을 위한 최소 침습 좁은 인터페이스 (Narrow Port Interface).
 *
 * [런타임 어댑터 연결 안내 (Runtime Adapter Guidance)]
 * 실제 Supabase 클라이언트(`supabase.rpc(...)`)는 `PostgrestFilterBuilder` 또는
 * 복잡한 내부 `PromiseLike`를 반환하므로, 런타임 조립 계층에서 다음과 같은 얇은 래퍼(Thin Wrapper)로
 * 감싸서 주입합니다:
 *
 * ```ts
 * const rpcClient: OutboxSupabaseRpcClient = {
 *   async rpc(fn, params) {
 *     const res = await supabase.rpc(fn, params)
 *     return { data: res.data, error: res.error }
 *   }
 * }
 * ```
 * 이를 통해 불필요하거나 무리한 `any` 캐스팅 없이 완벽한 타입 안전성과 격리성을 보장합니다.
 */
export interface OutboxSupabaseRpcClient {
  rpc<T = unknown>(
    fn: string,
    params: Record<string, unknown>,
  ): Promise<OutboxRpcResponse<T>>
}

export class SupabaseNotificationOutboxStore implements StorePort {
  constructor(
    private readonly client: OutboxSupabaseRpcClient,
    private readonly tokenFactory: () => string = () => crypto.randomUUID(),
  ) {}

  /**
   * Outbox 작업 점유 (Claim)
   * 신규 리스 토큰을 생성하고 RPC를 통해 단일 작업을 점유합니다.
   * 성공(data === true) 시 생성된 leaseToken을 반환하고, 실패 시 null을 반환합니다.
   */
  async claim(jobId: string): Promise<string | null> {
    if (!jobId || !jobId.trim()) {
      throw new OutboxStoreError()
    }

    try {
      const token = this.tokenFactory()
      if (!token || !token.trim()) {
        throw new OutboxStoreError()
      }

      const { data, error } = await this.client.rpc<boolean>(
        'claim_kakao_notification_job',
        {
          p_job_id: jobId,
          p_lease_token: token,
        },
      )

      if (error) {
        throw new OutboxStoreError()
      }

      return data === true ? token : null
    } catch {
      throw new OutboxStoreError()
    }
  }

  /**
   * 발송 직전 CAS 점유 (markSending)
   * 외부 통신 시작 전 상태를 SENDING으로 원자적 전이합니다.
   */
  async markSending(jobId: string, token: string): Promise<boolean> {
    if (!jobId || !jobId.trim() || !token || !token.trim()) {
      throw new OutboxStoreError()
    }

    try {
      const { data, error } = await this.client.rpc<boolean>(
        'mark_kakao_notification_sending',
        {
          p_job_id: jobId,
          p_lease_token: token,
        },
      )

      if (error) {
        throw new OutboxStoreError()
      }

      return data === true
    } catch {
      throw new OutboxStoreError()
    }
  }

  /**
   * Outbox 작업 최종 정산 (finish)
   * 발송 성공(SENT), 차단(BLOCKED), 대체(SUPERSEDED), 미확인(UNKNOWN) 상태로 전이합니다.
   */
  async finish(
    jobId: string,
    token: string,
    state: OutboxState,
    reasonCode: string,
  ): Promise<boolean> {
    if (
      !jobId ||
      !jobId.trim() ||
      !token ||
      !token.trim() ||
      !reasonCode ||
      !reasonCode.trim()
    ) {
      throw new OutboxStoreError()
    }

    try {
      const { data, error } = await this.client.rpc<boolean>(
        'finish_kakao_notification_job',
        {
          p_job_id: jobId,
          p_lease_token: token,
          p_status: state,
          p_reason_code: reasonCode.trim(),
        },
      )

      if (error) {
        throw new OutboxStoreError()
      }

      return data === true
    } catch {
      throw new OutboxStoreError()
    }
  }
}
