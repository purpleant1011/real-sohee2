import { randomUUID } from 'node:crypto'
import { STANDARD_ACTION_CREDIT_COSTS } from '@/features/credit-economy/quote-and-policy'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { recordGenerationCostSettled } from './first-value-observation'

export type QuickCreditScope = 'text' | 'image' | 'both'

type CreditAdmin = {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: any; error: { message?: string } | null }>
  from?(table: string): any
}

export class QuickPostCreditFailure extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message)
    this.name = 'QuickPostCreditFailure'
  }
}

export function quickPostCost(scope: QuickCreditScope): number {
  const text = STANDARD_ACTION_CREDIT_COSTS.INSTAGRAM_POST_GENERATE.cost
  const image = STANDARD_ACTION_CREDIT_COSTS.IMAGE_STUDIO_HD_RENDER.cost
  return (scope === 'image' ? 0 : text) + (scope === 'text' ? 0 : image)
}

// Deliberately NOT charged: SNS_DIRECT_PUBLISH (50 SC). Publishing is free in the quick-post lane (the hub says so).
// Charging it needs a new reservation scope: quick_post_credit_reservations is unique per (workspace, mission, revision),
// so a 'publish' reservation would collide with the draft one. That means changing the money RPCs and the
// approve/publish/retry lifecycle (reserve -> settle on PUBLISHED_VERIFIED -> release on FAILED). Decide pricing first.
export function quickPostOperationKey(missionId: string, revision: number, scope: QuickCreditScope): string {
  return `quick-post:${missionId}:${revision}:${scope}`
}

export type QuickPostReservation = {
  reservationId: string
  state: 'reserved' | 'settled' | 'released'
  requestedCredits: number
  operationKey: string
  isReplay: boolean
}

async function attemptSelfHealSignupCredits(params: {
  admin: CreditAdmin
  workspaceId: string
  userId?: string
}): Promise<boolean> {
  try {
    const adminClient = (typeof (params.admin as any).from === 'function'
      ? params.admin
      : createAdminSupabaseClient()) as any

    let userId = params.userId
    if (!userId && typeof adminClient.from === 'function') {
      const { data: ws } = await adminClient
        .from('workspaces')
        .select('created_by')
        .eq('id', params.workspaceId)
        .maybeSingle()
      userId = ws?.created_by
    }
    if (!userId) return false

    if (typeof adminClient.from === 'function') {
      const { data: connections, error: connErr } = await adminClient
        .from('channel_connections')
        .select('channel, status')
        .eq('workspace_id', params.workspaceId)
      if (connErr || !connections || connections.length === 0) return false

      const hasConnectedSns = connections.some((row: any) => {
        const ch = String(row.channel ?? '').toLowerCase()
        const st = String(row.status ?? '').toLowerCase()
        return (ch === 'instagram' || ch === 'threads') && (st === 'connected' || st === 'verified')
      })
      if (!hasConnectedSns) return false

      const { data: grants, error: grantErr } = await adminClient
        .from('credit_ledger_entries')
        .select('id, idempotency_key')
        .eq('workspace_id', params.workspaceId)
        .eq('kind', 'grant')
      if (grantErr) return false

      const hasSignupGrant = (grants ?? []).some((entry: any) =>
        typeof entry.idempotency_key === 'string' && entry.idempotency_key.startsWith('signup-first-post')
      )
      if (hasSignupGrant) return false
    }

    const { error: rpcErr } = await adminClient.rpc('ensure_signup_starter_credits', {
      p_user_id: userId,
      p_workspace_id: params.workspaceId,
    })
    if (rpcErr) {
      console.warn('[quick-post-credits] self-heal ensure_signup_starter_credits failed:', rpcErr)
      return false
    }

    return true
  } catch (err) {
    console.warn('[quick-post-credits] self-heal exception:', err)
    return false
  }
}

export async function reserveQuickPostCredits(params: {
  admin: CreditAdmin; workspaceId: string; missionId: string; revision: number; scope: QuickCreditScope; userId?: string
}): Promise<QuickPostReservation> {
  const { admin, workspaceId, missionId, revision, scope } = params
  const amount = quickPostCost(scope)
  const operationKey = quickPostOperationKey(missionId, revision, scope)
  const reservationId = randomUUID()

  const callRpc = () =>
    admin.rpc('reserve_quick_post_credits', {
      p_workspace_id: workspaceId,
      p_mission_id: missionId,
      p_revision: revision,
      p_scope: scope,
      p_credits: amount,
      p_reservation_id: reservationId,
    })

  let { data, error } = await callRpc()

  // 일시적인 RPC/네트워크 지연 시 1회 자동 재시도
  if (error && !data) {
    console.warn('[quick-post-credits] reserve_quick_post_credits initial call failed, retrying once:', {
      workspaceId,
      missionId,
      revision,
      code: (error as any)?.code,
      message: error.message,
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    const retry = await callRpc()
    data = retry.data
    error = retry.error
  }

  // SNS 1곳 이상 연결되었으나 가입 크레딧이 누락된 경우 1회 자가 복구 시도
  if (data?.state === 'insufficient' && Number.isInteger(data.availableCredits) && !error) {
    const healed = await attemptSelfHealSignupCredits({
      admin,
      workspaceId,
      userId: params.userId,
    })
    if (healed) {
      const retry = await callRpc()
      data = retry.data
      error = retry.error
    }
  }

  if (data?.state === 'insufficient' && Number.isInteger(data.availableCredits) && !error) {
    throw new QuickPostCreditFailure(`사장님 크레딧이 부족해요. 필요 ${amount} / 보유 ${data.availableCredits}. 시작 크레딧은 SNS 1곳 연결 후 지급돼요. 이미 받으셨다면 남은 크레딧을 확인해 주세요.`, 'INSUFFICIENT_CREDITS', 402)
  }

  if (error) {
    console.error('[quick-post-credits] reserve_quick_post_credits RPC error:', {
      workspaceId,
      missionId,
      revision,
      scope,
      code: (error as any)?.code,
      message: error.message,
    })
    throw new QuickPostCreditFailure('크레딧 확인 중 일시적인 연결 지연이 발생했어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.', 'CREDIT_RESERVE_FAILED', 503)
  }

  if (!data || !['reserved', 'settled', 'released'].includes(data.state)
    || typeof data.reservationId !== 'string' || data.requestedCredits !== amount
    || typeof data.isReplay !== 'boolean') {
    console.error('[quick-post-credits] reserve_quick_post_credits invalid response data:', {
      workspaceId,
      missionId,
      revision,
      data,
    })
    throw new QuickPostCreditFailure('크레딧 상태를 확인하는 중 일시적인 지연이 발생했어요. 새로고침 후 다시 시도해 주세요.', 'CREDIT_RESERVE_FAILED', 503)
  }

  return { reservationId: data.reservationId, state: data.state, requestedCredits: amount, operationKey, isReplay: data.isReplay === true }
}

export async function settleQuickPostCredits(admin: CreditAdmin, workspaceId: string, reservation: QuickPostReservation): Promise<void> {
  const { data, error } = await admin.rpc('settle_quick_post_credits', {
    p_workspace_id: workspaceId, p_reservation_id: reservation.reservationId,
    p_operation_key: reservation.operationKey,
  })
  if (error) {
    console.error('[quick-post-credits] settle_quick_post_credits RPC error:', {
      workspaceId,
      reservationId: reservation.reservationId,
      operationKey: reservation.operationKey,
      code: (error as any)?.code,
      message: error.message,
    })
  } else if (data?.reservationId !== reservation.reservationId || data?.state !== 'settled') {
    console.error('[quick-post-credits] settle_quick_post_credits invalid response:', {
      workspaceId,
      reservationId: reservation.reservationId,
      data,
    })
  }
  if (error || data?.reservationId !== reservation.reservationId || data?.state !== 'settled') {
    throw new QuickPostCreditFailure('콘텐츠는 저장되었지만 크레딧 정산을 확인하지 못했어요. 페이지를 새로고침해 주세요.', 'CREDIT_SETTLE_FAILED', 503)
  }
  // ANI-1602: observe cost only after the settle RPC confirmed the reservation (never from an estimate).
  if (typeof admin.from === 'function') {
    await recordGenerationCostSettled({ admin: admin as never, workspaceId, userId: null, reservation })
  }
}

export async function releaseQuickPostCredits(
  admin: CreditAdmin,
  workspaceId: string,
  reservation: QuickPostReservation
): Promise<{ state: 'released' | 'reserved'; missionExists?: boolean }> {
  const { data, error } = await admin.rpc('release_quick_post_credits', {
    p_workspace_id: workspaceId,
    p_reservation_id: reservation.reservationId,
    p_operation_key: reservation.operationKey,
  })
  const isProtectedOrReleased =
    data?.reservationId === reservation.reservationId &&
    (data?.state === 'released' || (data?.state === 'reserved' && data?.missionExists === true))

  if (error) {
    console.error('[quick-post-credits] release_quick_post_credits RPC error:', {
      workspaceId,
      reservationId: reservation.reservationId,
      operationKey: reservation.operationKey,
      code: (error as any)?.code,
      message: error.message,
    })
  } else if (!isProtectedOrReleased) {
    console.error('[quick-post-credits] release_quick_post_credits invalid response:', {
      workspaceId,
      reservationId: reservation.reservationId,
      data,
    })
  }
  if (error || !isProtectedOrReleased) {
    throw new QuickPostCreditFailure('크레딧 예약 해제 확인에 지연이 발생했어요. 새로고침 후 잔여 크레딧을 확인해 주세요.', 'CREDIT_RELEASE_FAILED', 503)
  }
  return data
}

export interface QuickPostReconcileResult {
  reconciled: boolean
  state: 'reserved' | 'settled' | 'released'
  missionExists: boolean
  activeLease?: boolean
  missionId?: string
  missionStatus?: string
  executionState?: string
  outcomeState?: string
  refundedCredits?: number
}

export async function reconcileQuickPostOrphan(
  admin: CreditAdmin,
  workspaceId: string,
  params: {
    reservationId: string
    operationKey: string
    maxLeaseSeconds?: number
  }
): Promise<QuickPostReconcileResult> {
  const leaseSeconds = Math.max(120, params.maxLeaseSeconds ?? 120)
  const { data, error } = await admin.rpc('reconcile_quick_post_orphan', {
    p_workspace_id: workspaceId,
    p_reservation_id: params.reservationId,
    p_operation_key: params.operationKey,
    p_max_lease_seconds: leaseSeconds,
  })

  const isValidShape =
    Boolean(data) &&
    typeof data === 'object' &&
    typeof data.reconciled === 'boolean' &&
    ['reserved', 'settled', 'released'].includes(data.state) &&
    typeof data.missionExists === 'boolean' &&
    (!data.missionExists || (typeof data.missionId === 'string' && data.missionId.trim().length > 0)) &&
    (data.activeLease === undefined || typeof data.activeLease === 'boolean') &&
    (data.refundedCredits === undefined || typeof data.refundedCredits === 'number') &&
    (data.missionStatus === undefined || typeof data.missionStatus === 'string') &&
    (data.executionState === undefined || typeof data.executionState === 'string') &&
    (data.outcomeState === undefined || typeof data.outcomeState === 'string') &&
    !(data.missionExists && data.reconciled) &&
    !(data.state === 'released' && data.missionExists)

  if (error || !isValidShape) {
    console.error('[quick-post-credits] reconcile_quick_post_orphan RPC error or invalid shape:', {
      workspaceId,
      reservationId: params.reservationId,
      error,
      data,
    })
    throw new QuickPostCreditFailure(
      '크레딧 예약 상태 조정 중 지연이 발생했어요. 잠시 후 다시 시도해 주세요.',
      'ORPHAN_RECONCILIATION_FAILED',
      503
    )
  }

  return data as QuickPostReconcileResult
}