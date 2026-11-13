import type { Database } from '@/lib/supabase/database.types'
import type { PushTokenLookup, PushTokenRecord } from '../push-token-status'

/**
 * 푸시 구독 조회 (ANI-1724, partial).
 *
 * 이 배포에는 아직 구독을 저장하는 테이블도, 구독을 등록하는 코드도, 푸시를 보내는 파이프라인도 없다.
 * 그래서 이 모듈은 **읽을 곳이 있으면 읽고, 없으면 상태 줄을 아예 그리지 않는다**는 계약만 고정한다.
 * 저장소가 생기기 전까지 화면에 '등록 없음'을 지어내지 않는다 — 그건 사실이 아니라 추측이다.
 *
 * 이 파일이 정의하는 읽기 계약(마이그레이션이 맞춰야 하는 모양):
 * - 테이블 `push_subscriptions`, RLS 로 `user_id = auth.uid()` 만 보이게 한다.
 * - 표시에 쓰는 칸은 `status`('active' | 'expired' | 'revoked'), `expires_at`, `revoked_at` 뿐이다.
 * - endpoint·키·토큰은 **읽지도 옮기지도 않는다**. 화면에는 상태만 나간다.
 * - 이 모듈은 읽기 전용이다. 쓰기·회전·폐기·발송은 서버 소유이며 여기서 하지 않는다.
 *
 * 정직성 규칙(fail-closed):
 * - 조회 실패(`ok: false`)는 '등록 없음'이 아니다. 화면에서 '확인하지 못했어요'로 남는다.
 * - 저장소가 없는 배포(`undefined`)는 '등록 없음'도 '확인 실패'도 아니다. 상태 줄 자체를 그리지 않는다.
 * - 저장소가 있는데 행이 없을 때만 `record: null`('아직 켜지 않았어요')이다.
 */

/** 구독 테이블 이름. 생성된 DB 타입에 이 이름이 생기면 조회가 켜진다. */
export const PUSH_SUBSCRIPTION_TABLE = 'push_subscriptions'

/**
 * 생성된 DB 타입에 구독 테이블이 있는지. 마이그레이션 뒤 `database.types.ts` 를 다시 생성하면 true 가 된다.
 * 아래 게이트를 켤 시점을 알려 주는 표지일 뿐, 값을 대신 계산해 주지는 않는다.
 */
export type PushSubscriptionTableKnown =
  'push_subscriptions' extends keyof Database['public']['Tables'] ? true : false

/**
 * 이 배포에 구독 저장소가 있는지. 지금은 없다(false).
 * 마이그레이션이 테이블을 만들고 타입을 다시 생성해 `PushSubscriptionTableKnown` 이 true 가 되면
 * 이 값을 true 로 바꾼다. 그 전까지는 조회 쿼리 자체를 보내지 않는다 —
 * 없는 테이블을 매 요청마다 찔러 오류 로그를 쌓거나, 없는 값을 '등록 없음'으로 지어내지 않는다.
 */
export const PUSH_SUBSCRIPTION_STORE_READY = false

/** 서버 조회 한 갈래. `empty` 는 '서버가 없음을 확인', `error` 는 '읽지 못함'이다. */
export type PushSubscriptionLookup =
  | { kind: 'row'; row: unknown }
  | { kind: 'empty' }
  | { kind: 'error' }

export interface PushTokenGateway {
  /** 로그인한 사용자의 구독 행 하나. RLS 가 다른 사용자 행을 가린다. */
  findSubscription(userId: string): Promise<PushSubscriptionLookup>
}

type SubscriptionQuery = {
  select(columns: string): SubscriptionQuery
  eq(column: string, value: string): SubscriptionQuery
  maybeSingle(): Promise<{ data: unknown; error: unknown }>
}

/** 사용자 세션 클라이언트로만 읽는다(service role 금지 — RLS 를 우회하면 안 된다). */
async function createGateway(): Promise<PushTokenGateway> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const supabase = await createServerSupabaseClient()
  // 테이블이 아직 생성된 DB 타입에 없어 좁은 인터페이스로만 접근한다.
  const reader = supabase as unknown as { from(table: string): SubscriptionQuery }
  return {
    async findSubscription(userId) {
      try {
        const { data, error } = await reader
          .from(PUSH_SUBSCRIPTION_TABLE)
          .select('status, expires_at, revoked_at')
          .eq('user_id', userId)
          .maybeSingle()
        if (error) return { kind: 'error' }
        if (data === null || data === undefined) return { kind: 'empty' }
        return { kind: 'row', row: data }
      } catch {
        return { kind: 'error' }
      }
    },
  }
}

function field(row: Record<string, unknown>, snake: string, camel: string): unknown {
  return row[snake] !== undefined ? row[snake] : row[camel]
}

/**
 * DB 행 → 표시용 record. 표시에 쓰지 않는 값(endpoint·키·토큰·id)은 옮기지 않는다.
 * 해석할 수 없는 값은 그대로 넘겨 `resolvePushTokenStatus` 가 fail-closed 로 `unknown` 처리하게 둔다.
 */
export function toPushTokenRecord(row: Record<string, unknown>): PushTokenRecord {
  return {
    status: field(row, 'status', 'status'),
    expiresAt: field(row, 'expires_at', 'expiresAt'),
    revokedAt: field(row, 'revoked_at', 'revokedAt'),
  }
}

/**
 * 알림 설정 화면에 넘길 조회 결과.
 *
 * - `undefined` — 구독 저장소가 없는 배포. 상태 줄을 그리지 않는다(조회도 하지 않는다).
 * - `{ ok: false }` — 저장소는 있으나 읽지 못함. '확인하지 못했어요'.
 * - `{ ok: true, record }` — 서버가 확인한 값. `record: null` 은 '등록된 구독 없음'.
 */
export async function readPushTokenLookup(input: {
  userId: string
  /** 테스트·프리뷰용 재정의. 지정하지 않으면 `PUSH_SUBSCRIPTION_STORE_READY` 를 쓴다. */
  storeReady?: boolean
  gateway?: PushTokenGateway
}): Promise<PushTokenLookup | undefined> {
  const storeReady = input.storeReady ?? PUSH_SUBSCRIPTION_STORE_READY
  // 읽을 곳이 없으면 쿼리를 보내지 않는다. 없는 테이블을 매 요청마다 찔러 오류 로그를 쌓지 않는다.
  if (!storeReady) return undefined

  try {
    const gateway = input.gateway ?? await createGateway()
    const found = await gateway.findSubscription(input.userId)
    if (found.kind === 'error') return { ok: false }
    if (found.kind === 'empty') return { ok: true, record: null }
    if (typeof found.row !== 'object' || found.row === null || Array.isArray(found.row)) return { ok: false }
    return { ok: true, record: toPushTokenRecord(found.row as Record<string, unknown>) }
  } catch {
    return { ok: false }
  }
}
