/**
 * Supabase Notification Outbox 어댑터 포트 팩토리 (Supabase Outbox Ports Factory)
 *
 * [보안 및 안정성 철칙]
 * 1. Provider 내부 에러 및 PII 은닉: Supabase/PostgREST/Postgres 원문 에러를 외부에 반환하지 않고 정적 오류로 치환합니다.
 * 2. 마이크로초 문자열 보존: timestamptz를 Date로 파싱하지 않고 raw string 그대로 유지하여 버전 무결성을 보장합니다.
 * 3. 런타임 타입 검증 (Fail-Closed): DB row를 임의로 Job으로 단언(as Job)하지 않고, 필수 필드 및 이벤트 화이트리스트를 검증합니다.
 * 4. any 배제: Supabase client와의 통신에 any 캐스팅을 배제하고 구조적 타입을 엄격히 준수합니다.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Job, NotificationEvent } from './outbox-processor'
import type { OutboxRpcResponse, OutboxSupabaseRpcClient } from './outbox-store'
import type { ReservationDbRow, ReservationQueryFn } from './outbox-repository'

export type { OutboxRpcResponse, OutboxSupabaseRpcClient }

export interface OutboxSourcePort {
  listDueJobs(limit: number, now: Date): Promise<Job[]>
  expireSending(): Promise<number>
}

export interface SupabaseOutboxPorts {
  rpcClient: OutboxSupabaseRpcClient
  reservationReader: ReservationQueryFn
  source: OutboxSourcePort
}

const ALLOWED_EVENTS = new Set<NotificationEvent>([
  'BOOKING_CONFIRMED',
  'BOOKING_CHANGED',
  'BOOKING_CANCELLED',
  'REMINDER_24H',
  'REMINDER_2H',
  'PAYMENT_CONFIRMED',
])

function isAllowedEvent(event: unknown): event is NotificationEvent {
  return typeof event === 'string' && ALLOWED_EVENTS.has(event as NotificationEvent)
}

/**
 * SupabaseClient의 최소 필요 메서드 타입 정의 (테스트 mock 및 실제 클라이언트 완벽 호환)
 */
export type SupabaseOutboxClient = Pick<SupabaseClient, 'rpc' | 'from'>

/**
 * Supabase Notification Outbox용 런타임 포트 조립 팩토리
 */
export function createSupabaseOutboxPorts(client: SupabaseOutboxClient): SupabaseOutboxPorts {
  // 1. rpcClient: client.rpc에 대한 thin wrapper (any 배제, 정적 에러 은닉, this 바인딩 유지)
  const rpcClient: OutboxSupabaseRpcClient = {
    async rpc<T = unknown>(
      fn: string,
      params: Record<string, unknown>,
    ): Promise<OutboxRpcResponse<T>> {
      try {
        const res = await (client.rpc(fn, params) as unknown as PromiseLike<{
          data: T | null
          error: unknown
        }>)

        if (res.error) {
          return {
            data: null,
            error: { message: 'Outbox RPC execution failed' },
          }
        }

        return {
          data: res.data ?? null,
          error: null,
        }
      } catch {
        return {
          data: null,
          error: { message: 'Outbox RPC execution failed' },
        }
      }
    },
  }

  // 2. reservationReader: reservations 테이블 단건 조회 및 business_profiles canonical 매장 정보 병합
  // [주의 1] reservations 실제 스키마에는 customer_phone만 존재하며 독립 phone 컬럼은 없음 (Postgres 42703 오류 방지)
  // [주의 2] 예약 metadata의 shopName/locationText를 신뢰하지 않고 business_profiles(business_name, location)의
  //          canonical 값을 우선 병합. profile이 없거나 blank면 빈 상태 유지(가짜 이름 default 금지)하여 sender에서 차단되도록 유도.
  const reservationReader: ReservationQueryFn = async (params) => {
    const wsId = (params.workspaceId || '').trim()
    const resId = (params.reservationId || '').trim()

    if (!wsId || !resId) {
      return null
    }

    try {
      type ReservationsQueryBuilder = {
        select(cols: string): {
          eq(col1: string, val1: string): {
            eq(col2: string, val2: string): {
              maybeSingle(): PromiseLike<{ data: ReservationDbRow | null; error: unknown }>
            }
          }
        }
      }

      type BusinessProfileDbRow = {
        business_name?: string | null
        location?: string | null
      }

      type BusinessProfilesQueryBuilder = {
        select(cols: string): {
          eq(col: string, val: string): {
            maybeSingle(): PromiseLike<{ data: BusinessProfileDbRow | null; error: unknown }>
          }
        }
      }

      const resQb = client.from('reservations') as unknown as ReservationsQueryBuilder
      const res = await resQb
        .select(
          'id, workspace_id, status, customer_id, customer_name, customer_phone, service_name, cancel_reason, metadata, updated_at',
        )
        .eq('workspace_id', wsId)
        .eq('id', resId)
        .maybeSingle()

      if (res.error) {
        throw new Error('RESERVATION_READ_FAILED')
      }

      const row = res.data
      if (!row) {
        return null
      }

      // 정규 원천 business_profiles에서 canonical 매장명 및 위치(location) 조회
      const bpQb = client.from('business_profiles') as unknown as BusinessProfilesQueryBuilder
      const profileRes = await bpQb
        .select('business_name, location')
        .eq('workspace_id', wsId)
        .maybeSingle()

      if (profileRes.error) {
        throw new Error('RESERVATION_READ_FAILED')
      }

      const profile = profileRes.data
      const baseMetadata: Record<string, unknown> = { ...(row.metadata ?? {}) }

      // 기존 untrusted 매장 정보는 단정하지 않고 canonical profile 값으로 엄격 제어
      delete baseMetadata.shopName
      delete baseMetadata.locationText

      if (typeof profile?.business_name === 'string' && profile.business_name.trim().length > 0) {
        baseMetadata.shopName = profile.business_name.trim()
      }
      if (typeof profile?.location === 'string' && profile.location.trim().length > 0) {
        baseMetadata.locationText = profile.location.trim()
      }

      // 결제 금액: PAYMENT_CONFIRMED 이벤트인 경우만 LIVE 확정 건을 payment_captures에서 조회 (deposit_krw 단독 추정 금지)
      let paymentAmountKrw: number | undefined
      if (params.event === 'PAYMENT_CONFIRMED') {
        try {
          type DepositIntentsQueryBuilder = {
            select(cols: string): {
              eq(col1: string, val1: string): {
                eq(col2: string, val2: string): PromiseLike<{
                  data: Array<{ id: string }> | null
                  error: unknown
                }>
              }
            }
          }
          type PaymentCapturesQueryBuilder = {
            select(cols: string): {
              eq(col1: string, val1: string): {
                eq(col2: string, val2: string): {
                  in(col3: string, vals: string[]): {
                    order(
                      col4: string,
                      opts: { ascending: boolean },
                    ): {
                      limit(count: number): {
                        maybeSingle(): PromiseLike<{
                          data: { amount_krw: number } | null
                          error: unknown
                        }>
                      }
                    }
                  }
                }
              }
            }
          }

          const diQb = client.from('deposit_intents') as unknown as DepositIntentsQueryBuilder
          const diRes = await diQb
            .select('id')
            .eq('workspace_id', wsId)
            .eq('booking_id', resId)

          if (diRes.data && diRes.data.length > 0) {
            const intentIds = diRes.data.map((d) => d.id)
            const pcQb = client.from('payment_captures') as unknown as PaymentCapturesQueryBuilder
            const pcRes = await pcQb
              .select('amount_krw')
              .eq('workspace_id', wsId)
              .eq('dataset_mode', 'LIVE')
              .in('intent_id', intentIds)
              .order('paid_at', { ascending: false })
              .limit(1)
              .maybeSingle()

            if (pcRes.data && typeof pcRes.data.amount_krw === 'number') {
              paymentAmountKrw = pcRes.data.amount_krw
            }
          }
        } catch {
          // payment_captures 연동이 지원되지 않거나 테이블 mock 부재 시 fail-closed(undefined 유지)
        }
      }

      return {
        ...row,
        payment_amount_krw: paymentAmountKrw,
        metadata: Object.keys(baseMetadata).length > 0 ? baseMetadata : undefined,
      }
    } catch {
      throw new Error('RESERVATION_READ_FAILED')
    }
  }

  // 3. source: 실행 대기 작업 조회 및 타임아웃 만료 RPC
  const source: OutboxSourcePort = {
    async listDueJobs(limit: number, now: Date): Promise<Job[]> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new Error('INVALID_LIMIT')
      }

      if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new Error('INVALID_NOW')
      }

      const nowIso = now.toISOString()
      const orFilter = `and(status.eq.READY,due_at.lte.${nowIso}),and(status.eq.CLAIMED,lease_until.lte.${nowIso})`

      type OutboxDbRow = {
        id: string
        workspace_id: string
        reservation_id: string
        reservation_updated_at: string
        event: string
        due_at: string
        status: string
        lease_until: string | null
      }

      type OutboxQueryBuilder = {
        select(cols: string): {
          or(filter: string): {
            order(
              col: string,
              options: { ascending: boolean },
            ): {
              limit(count: number): PromiseLike<{ data: OutboxDbRow[] | null; error: unknown }>
            }
          }
        }
      }

      let rows: OutboxDbRow[] | null = null
      try {
        const qb = client.from('kakao_notification_outbox') as unknown as OutboxQueryBuilder
        const res = await qb
          .select(
            'id, workspace_id, reservation_id, reservation_updated_at, event, due_at, status, lease_until',
          )
          .or(orFilter)
          .order('due_at', { ascending: true })
          .limit(limit)

        if (res.error) {
          throw new Error('OUTBOX_SOURCE_QUERY_FAILED')
        }

        rows = res.data
      } catch {
        throw new Error('OUTBOX_SOURCE_QUERY_FAILED')
      }

      if (!rows || !Array.isArray(rows)) {
        return []
      }

      // 런타임 타입 검증 및 화이트리스트 검사 (임의 캐스팅 금지)
      const jobs: Job[] = []
      for (const row of rows) {
        if (!row || typeof row !== 'object') {
          throw new Error('INVALID_OUTBOX_ROW')
        }

        const { id, workspace_id, reservation_id, reservation_updated_at, event, due_at } = row

        if (
          typeof id !== 'string' ||
          !id.trim() ||
          typeof workspace_id !== 'string' ||
          !workspace_id.trim() ||
          typeof reservation_id !== 'string' ||
          !reservation_id.trim() ||
          typeof reservation_updated_at !== 'string' ||
          !reservation_updated_at.trim() ||
          typeof due_at !== 'string' ||
          !due_at.trim()
        ) {
          throw new Error('INVALID_OUTBOX_ROW')
        }

        if (!isAllowedEvent(event)) {
          throw new Error('INVALID_OUTBOX_ROW')
        }

        // raw timestamp 문자열 보존 (마이크로초 절삭 방지)
        jobs.push({
          id,
          workspaceId: workspace_id,
          reservationId: reservation_id,
          reservationUpdatedAt: reservation_updated_at,
          event,
          dueAt: due_at,
        })
      }

      return jobs
    },

    async expireSending(): Promise<number> {
      try {
        const res = await (client.rpc('expire_kakao_notification_jobs') as unknown as PromiseLike<{
          data: unknown
          error: unknown
        }>)

        if (res.error) {
          throw new Error('EXPIRE_SENDING_FAILED')
        }

        const count = res.data
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
          throw new Error('EXPIRE_SENDING_FAILED')
        }

        return count
      } catch {
        throw new Error('EXPIRE_SENDING_FAILED')
      }
    },
  }

  return {
    rpcClient,
    reservationReader,
    source,
  }
}
