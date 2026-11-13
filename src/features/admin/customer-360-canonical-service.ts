import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

export const CANONICAL_BYREUM_PRODUCTION_WORKSPACE_ID = '00000000-0000-4000-8000-0000000000a2'

export interface TenantIdentityBar {
  workspaceId: string
  displayName: string
  ownerEmail: string
  isProduction: boolean
  badgeLabel: 'PRODUCTION_PRIMARY' | 'DEMO_SANDBOX'
  status: 'ACTIVE' | 'SUSPENDED'
}

export interface Customer360Metrics {
  missionsCount: number
  contentsCount: number
  approvalsCount: number
  publishReceiptsCount: number
  reservationsCount: number
  totalVerifiedRevenueKrw: number
}

export interface Customer360Profile {
  identity: TenantIdentityBar
  metrics: Customer360Metrics
  recentMissions: Array<{
    id: string
    goal: string
    status: string
    traceId: string
    createdAt: string
  }>
}

export type RevenueObservationState = 'OBSERVED' | 'NOT_OBSERVED' | 'ERROR'

export interface CanonicalCustomer360Metrics {
  /** 입금/결제 관측 근거가 연결되기 전에는 항상 null. 예약 금액을 매출로 대체하지 않는다. */
  totalRevenue: number | null
  revenueState: RevenueObservationState
  confirmedBookings: number
  activeMissionsCount: number
  missionsCount: number
}

export class Customer360CanonicalService {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /**
   * Builds the Authoritative Tenant Identity Bar, strictly differentiating
   * the real production 바이름 tenant from test/demo workspaces.
   */
  public async buildTenantIdentityBar(workspaceId: string): Promise<TenantIdentityBar> {
    const isProduction = workspaceId === CANONICAL_BYREUM_PRODUCTION_WORKSPACE_ID

    const { data: ws } = await (this.client as any)
      .from('workspaces')
      .select('*')
      .eq('id', workspaceId)
      .single()

    const displayName = ws?.display_name || (isProduction ? '바이름' : '바이름 (테스트)')
    const ownerEmail = ws?.owner_email || (isProduction ? 'admin@example.com' : 'admin@example.com')

    return {
      workspaceId,
      displayName,
      ownerEmail,
      isProduction,
      badgeLabel: isProduction ? 'PRODUCTION_PRIMARY' : 'DEMO_SANDBOX',
      status: 'ACTIVE',
    }
  }

  /**
   * Fetches full Customer 360 profile strictly aggregated from DB ground truth.
   */
  public async fetchCustomer360Profile(workspaceId: string): Promise<Customer360Profile> {
    const identity = await this.buildTenantIdentityBar(workspaceId)

    // 1. Missions
    const { data: missions } = await (this.client as any)
      .from('marketing_missions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(20)

    const missionList = missions || []

    // 2. Contents
    const { data: contents } = await (this.client as any)
      .from('content_items')
      .select('id')
      .eq('workspace_id', workspaceId)

    // 3. Approvals
    const { data: approvals } = await (this.client as any)
      .from('approvals')
      .select('id')
      .eq('workspace_id', workspaceId)

    // 4. Publish receipts
    const { data: receipts } = await (this.client as any)
      .from('external_action_receipts')
      .select('id')
      .eq('workspace_id', workspaceId)

    // 5. Confirmed reservations & verified revenue
    const { data: reservations } = await (this.client as any)
      .from('reservations')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('status', 'CONFIRMED')

    const resList = reservations || []
    const totalVerifiedRevenueKrw = resList.reduce(
      (sum: number, r: any) => sum + (Number(r.total_amount_krw) || 0),
      0
    )

    return {
      identity,
      metrics: {
        missionsCount: missionList.length,
        contentsCount: contents?.length || 0,
        approvalsCount: approvals?.length || 0,
        publishReceiptsCount: receipts?.length || 0,
        reservationsCount: resList.length,
        totalVerifiedRevenueKrw,
      },
      recentMissions: missionList.map((m: any) => ({
        id: m.id,
        goal: m.goal,
        status: m.status,
        traceId: m.trace_id,
        createdAt: m.created_at,
      })),
    }
  }
}

export function buildCustomer360CanonicalProfile(input: {
  workspaceId: string
  workspaceName: string
  ownerEmail?: string
  ownerName?: string
  missions?: any[]
  reservations?: any[]
  incidents?: any[]
}) {
  const isProduction = input.workspaceId === CANONICAL_BYREUM_PRODUCTION_WORKSPACE_ID
  const confirmedReservations = (input.reservations || []).filter(
    (r: any) => r.status === 'CONFIRMED'
  )
  const activeMissions = (input.missions || []).filter(
    (m: any) => m.status !== 'ARCHIVED' && m.status !== 'FAILED'
  )
  const metrics: CanonicalCustomer360Metrics = {
    // 예약 금액(servicePrice/total_amount_krw)은 입금/결제 관측 근거가 아니므로 매출로 합산하지 않는다.
    totalRevenue: null,
    revenueState: 'NOT_OBSERVED',
    confirmedBookings: confirmedReservations.length,
    activeMissionsCount: activeMissions.length,
    missionsCount: (input.missions || []).length,
  }

  return {
    identityBar: {
      badge: isProduction ? ('PRODUCTION_PRIMARY' as const) : ('DEMO_SANDBOX' as const),
      workspaceId: input.workspaceId,
      displayName: input.workspaceName || (isProduction ? '바이름' : '바이름 (테스트)'),
      ownerEmail: input.ownerEmail || (isProduction ? 'admin@example.com' : 'admin@example.com'),
      isProduction,
    },
    metrics,
    missions: input.missions || [],
    reservations: input.reservations || [],
  }
}

