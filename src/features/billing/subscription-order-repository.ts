import type { SupabaseClient } from '@supabase/supabase-js'
import type { SubscriptionOrder, SubscriptionOrderStatus } from './subscription-order'
import type { SubscriptionConsentRecord } from './subscription-consent'

export type ConsentRecord = SubscriptionConsentRecord

export type SubscriptionOrderDraft = Readonly<{
  orderId?: string
  id?: string
  workspaceId: string
  offerCode: string
  amountKrw: number
  currency?: 'KRW'
  status?: SubscriptionOrderStatus
  idempotencyKey: string
  actorUserId?: string
  createdAt?: string
}>

export type CreateSubscriptionOrderParams = Readonly<{
  order: SubscriptionOrderDraft
  consents: readonly ConsentRecord[]
  createdBy?: string
}>

export type CreateSubscriptionOrderResult = Readonly<{
  order: SubscriptionOrder
  created: boolean
}>

export type ListSubscriptionOrdersOptions = Readonly<{
  limit?: number
}>

type SubscriptionOrderRow = {
  id: string
  workspace_id: string
  offer_code: string
  amount_krw: number
  currency: string
  status: string
  idempotency_key: string
  created_by: string | null
  created_at: string
}

export type SupabaseOrderDbClient =
  | Pick<SupabaseClient<any>, 'from'>
  | {
      from(table: string): any
    }

function mapOrderRowToDomain(row: SubscriptionOrderRow): SubscriptionOrder {
  return Object.freeze({
    orderId: row.id,
    offerCode: row.offer_code,
    workspaceId: row.workspace_id,
    actorUserId: row.created_by ?? '',
    idempotencyKey: row.idempotency_key,
    amountKrw: row.amount_krw,
    currency: (row.currency ?? 'KRW') as 'KRW',
    status: row.status as SubscriptionOrderStatus,
    createdAt: row.created_at,
  })
}

/**
 * 워크스페이스 ID와 멱등성 키로 기존 주문을 조회한다.
 * 없으면 null 반환.
 */
export async function findOrderByWorkspaceAndIdempotencyKey(
  client: SupabaseOrderDbClient,
  workspaceId: string,
  idempotencyKey: string
): Promise<SubscriptionOrder | null> {
  const { data, error } = await client
    .from('subscription_orders')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  if (error) {
    throw new Error(error.message || 'SUBSCRIPTION_ORDER_QUERY_FAILED')
  }

  if (!data) {
    return null
  }

  return mapOrderRowToDomain(data as SubscriptionOrderRow)
}

/**
 * 멱등성을 보장하며 주문과 동의 내역을 DB에 영속화한다.
 * 이미 동일한 (workspaceId, idempotencyKey) 주문이 존재하면 기존 주문을 반환하며 created: false로 응답한다.
 */
export async function createSubscriptionOrderWithConsents(
  client: SupabaseOrderDbClient,
  params: CreateSubscriptionOrderParams
): Promise<CreateSubscriptionOrderResult> {
  const existingOrder = await findOrderByWorkspaceAndIdempotencyKey(
    client,
    params.order.workspaceId,
    params.order.idempotencyKey
  )

  if (existingOrder) {
    return Object.freeze({
      order: existingOrder,
      created: false,
    })
  }

  const orderPayload: Record<string, unknown> = {
    workspace_id: params.order.workspaceId,
    offer_code: params.order.offerCode,
    amount_krw: params.order.amountKrw,
    currency: params.order.currency ?? 'KRW',
    status: params.order.status ?? 'created',
    idempotency_key: params.order.idempotencyKey,
    created_by: params.createdBy ?? params.order.actorUserId ?? null,
  }

  const explicitId = params.order.orderId ?? params.order.id
  if (explicitId) {
    orderPayload.id = explicitId
  }

  const { data: createdRow, error: orderError } = await client
    .from('subscription_orders')
    .insert(orderPayload)
    .select()
    .single()

  if (orderError) {
    // 동시 요청으로 인한 unique 충돌(23505) 발생 시 재조회로 멱등성 보장
    const isUniqueConflict =
      orderError.code === '23505' ||
      (typeof orderError.message === 'string' &&
        orderError.message.toLowerCase().includes('unique'))

    if (isUniqueConflict) {
      const concurrentOrder = await findOrderByWorkspaceAndIdempotencyKey(
        client,
        params.order.workspaceId,
        params.order.idempotencyKey
      )
      if (concurrentOrder) {
        return Object.freeze({
          order: concurrentOrder,
          created: false,
        })
      }
    }

    throw new Error(orderError.message || 'SUBSCRIPTION_ORDER_INSERT_FAILED')
  }

  const order = mapOrderRowToDomain(createdRow as SubscriptionOrderRow)

  if (params.consents && params.consents.length > 0) {
    const consentRows = params.consents.map((consent) => ({
      order_id: order.orderId,
      kind: consent.kind,
      policy_version: consent.policyVersion,
      accepted_at: consent.acceptedAt,
    }))

    const { error: consentError } = await client
      .from('subscription_consents')
      .insert(consentRows)

    if (consentError) {
      throw new Error(consentError.message || 'SUBSCRIPTION_CONSENTS_INSERT_FAILED')
    }
  }

  return Object.freeze({
    order,
    created: true,
  })
}

/**
 * 워크스페이스에 속한 구독 주문 목록을 created_at desc 정렬하여 조회한다.
 */
export async function listSubscriptionOrdersByWorkspace(
  client: SupabaseOrderDbClient,
  workspaceId: string,
  options?: ListSubscriptionOrdersOptions
): Promise<readonly SubscriptionOrder[]> {
  const limit = options?.limit ?? 50

  const { data, error } = await client
    .from('subscription_orders')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error || !Array.isArray(data)) {
    throw new Error(error?.message || 'SUBSCRIPTION_ORDERS_QUERY_FAILED')
  }

  const rows = data as SubscriptionOrderRow[]
  return Object.freeze(rows.map(mapOrderRowToDomain))
}
