import 'server-only'

import { requireOperator } from '@/features/operator-auth/require-operator'
import type { OperatorPermission } from '@/features/operator-auth/permissions'
import { getOperatorOnboardingOverview } from '@/features/operator-onboarding/lifecycle-repository'
import type { OperatorOnboardingOverview } from '@/features/operator-onboarding/lifecycle-schemas'
import { listOperatorChannelConnections } from '@/features/operator-channels/repository'
import type { OperatorChannelConnection } from '@/features/operator-channels/schemas'
import { listOperatorPublishOperations } from '@/features/operator-publishing/publish-read-repository'
import type { OperatorPublishPage } from '@/features/operator-publishing/publish-read-repository'
import { listOperatorBillingOverview } from '@/features/operator-billing/billing-read-repository'
import type { BillingOverview } from '@/features/operator-billing/billing-read-schemas'
import { listOperatorAuditEvents } from '@/features/operator-audit/audit-read-repository'
import type { OperatorAuditReadEvent, OperatorAuditReadFilters } from '@/features/operator-audit/audit-read-repository'
import { listOperatorSupportSessions } from '@/features/operator-support/support-session-repository'
import type { SupportSession } from '@/features/operator-support/support-session-schemas'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { creditActionLabel, formatKst, referenceCode } from '@/components/admin-ui/labels'
import type { OperatorWorkspaceKnowledge } from './schemas'

export type DetailReadState<T> =
  | Readonly<{ kind: 'ready'; data: T; message?: undefined }>
  | Readonly<{ kind: 'empty'; data: T; message?: undefined }>
  | Readonly<{ kind: 'forbidden'; data: null; message: string }>
  | Readonly<{ kind: 'out_of_scope'; data: null; message: string }>
  | Readonly<{ kind: 'unavailable'; data: null; message: string }>
  | Readonly<{ kind: 'unknown'; data: null; message: string }>
  | Readonly<{ kind: 'not_connected'; data: null; message: string }>

export type OperatorCreditConsumption = Readonly<{
  id: string
  referenceId: string
  occurredAt: string
  action: string
  amount: number
  amountLabel: string
  idempotencyKey: string
  idempotencyReference: string
}>

export type OperatorWorkspaceDetailReads = Readonly<{
  lifecycle: DetailReadState<readonly OperatorOnboardingOverview[]>
  channels: DetailReadState<readonly OperatorChannelConnection[]>
  publishing: DetailReadState<OperatorPublishPage>
  billing: DetailReadState<BillingOverview>
  creditConsumptions: DetailReadState<readonly OperatorCreditConsumption[]>
  support: DetailReadState<readonly SupportSession[]> | Readonly<{ kind: 'not_connected'; message: '지원 기록 연결 전' }>
  audit: DetailReadState<Readonly<{ items: readonly OperatorAuditReadEvent[]; nextCursor: string | null }>>
  knowledge: DetailReadState<OperatorWorkspaceKnowledge>
}>

type Guard = (permission: OperatorPermission, workspaceId: string) => Promise<unknown>
type Dependencies = Readonly<{
  requireOperator?: Guard
  getOperatorOnboardingOverview?: typeof getOperatorOnboardingOverview
  listOperatorChannelConnections?: typeof listOperatorChannelConnections
  listOperatorPublishOperations?: typeof listOperatorPublishOperations
  listOperatorBillingOverview?: typeof listOperatorBillingOverview
  listOperatorAuditEvents?: typeof listOperatorAuditEvents
  listOperatorSupportSessions?: typeof listOperatorSupportSessions
  listWorkspaceCreditConsumptions?: (workspaceId: string, limit?: number) => Promise<{ data: readonly OperatorCreditConsumption[] | null; error: unknown }>
  getOperatorWorkspaceKnowledge?: typeof getOperatorWorkspaceKnowledge
}>

async function defaultListCreditConsumptions(
  workspaceId: string,
  limit = 50,
): Promise<{ data: readonly OperatorCreditConsumption[] | null; error: unknown }> {
  try {
    const adminDb = createAdminSupabaseClient()
    const { data, error } = await (adminDb as any)
      .from('credit_ledger_entries')
      .select('id, action, amount, idempotency_key, occurred_at')
      .eq('workspace_id', workspaceId)
      .eq('kind', 'consume')
      .order('occurred_at', { ascending: false })
      .limit(limit)

    if (error) return { data: null, error }
    if (!data) return { data: [], error: null }

    const items: OperatorCreditConsumption[] = data.map((row: any) => ({
      id: row.id,
      referenceId: referenceCode(row.id),
      occurredAt: formatKst(row.occurred_at),
      action: creditActionLabel(row.action),
      amount: row.amount,
      amountLabel: `-${Math.abs(row.amount).toLocaleString('ko-KR')} 크레딧`,
      idempotencyKey: row.idempotency_key,
      idempotencyReference: referenceCode(row.idempotency_key || row.id),
    }))

    return { data: items, error: null }
  } catch (err) {
    return { data: null, error: err }
  }
}

function errorCode(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  return ''
}

function errorState<T>(error: unknown): DetailReadState<T> {
  const code = errorCode(error)
  if (code === 'PERMISSION_DENIED' || code === 'OPERATOR_PERMISSION_DENIED') {
    return { kind: 'forbidden', data: null, message: '이 자료를 볼 권한이 없습니다.' }
  }
  if (code === 'WORKSPACE_SCOPE_DENIED' || code === 'OPERATOR_SCOPE_DENIED') {
    return { kind: 'out_of_scope', data: null, message: '이 고객사 범위에 포함되지 않습니다.' }
  }
  if (code === 'MFA_REQUIRED') {
    return { kind: 'unavailable', data: null, message: '추가 인증이 필요합니다.' }
  }
  return { kind: 'unavailable', data: null, message: '자료를 안전하게 불러오지 못했습니다.' }
}

function resultState<T>(result: Readonly<{ data: T | null; error: unknown }>): DetailReadState<T> {
  if (result.error !== null) return errorState(result.error)
  if (result.data === null) return { kind: 'unknown', data: null, message: '자료를 확인할 수 없습니다.' }
  if (Array.isArray(result.data) && result.data.length === 0) return { kind: 'empty', data: result.data, message: undefined }
  if (typeof result.data === 'object' && result.data !== null && 'items' in result.data && Array.isArray(result.data.items) && result.data.items.length === 0) {
    return { kind: 'empty', data: result.data, message: undefined }
  }
  return { kind: 'ready', data: result.data, message: undefined }
}

async function readSection<T>(
  permission: OperatorPermission,
  workspaceId: string,
  guard: Guard,
  read: () => Promise<Readonly<{ data: T | null; error: unknown; sourceState?: string }>>,
): Promise<DetailReadState<T>> {
  try {
    await guard(permission, workspaceId)
  } catch (error) {
    return errorState(error)
  }
  try {
    const result = await read()
    if (result.sourceState === 'not_connected') return { kind: 'not_connected', data: null, message: '자료 연결 전' }
    if (result.sourceState === 'empty' && result.data !== null) return { kind: 'empty', data: result.data, message: undefined }
    return resultState(result)
  } catch (error) {
    return errorState(error)
  }
}

export async function getOperatorWorkspaceKnowledge(
  workspaceId: string,
  client?: ReturnType<typeof createAdminSupabaseClient>,
): Promise<Readonly<{ data: OperatorWorkspaceKnowledge | null; error: unknown; sourceState?: 'ready' | 'empty' }>> {
  try {
    const admin = client ?? createAdminSupabaseClient()
    const [profileRes, channelRes] = await Promise.all([
      admin
        .from('business_profiles')
        .select('business_name, industry, location, summary, updated_at')
        .eq('workspace_id', workspaceId)
        .maybeSingle(),
      admin
        .from('channel_connections')
        .select('channel, status, account_label, external_account_id, updated_at')
        .eq('workspace_id', workspaceId)
        .eq('channel', 'naver_place')
        .maybeSingle(),
    ])

    if (profileRes.error) return { data: null, error: profileRes.error }
    if (channelRes.error) return { data: null, error: channelRes.error }

    const profile = profileRes.data
    const channel = channelRes.data

    if (!profile && !channel) {
      return {
        data: {
          placeUrl: null,
          placeStatus: null,
          businessName: null,
          industry: null,
          location: null,
          summary: null,
          updatedAt: null,
        },
        error: null,
        sourceState: 'empty',
      }
    }

    let placeUrl: string | null = null
    if (channel) {
      if (channel.account_label?.startsWith('http://') || channel.account_label?.startsWith('https://')) {
        placeUrl = channel.account_label
      } else if (channel.external_account_id?.startsWith('http://') || channel.external_account_id?.startsWith('https://')) {
        placeUrl = channel.external_account_id
      } else if (channel.external_account_id && /^\d+$/.test(channel.external_account_id)) {
        placeUrl = `https://m.place.naver.com/place/${channel.external_account_id}`
      } else {
        placeUrl = channel.account_label ?? null
      }
    }

    let updatedAt: string | null = null
    if (profile?.updated_at && channel?.updated_at) {
      updatedAt = new Date(profile.updated_at) > new Date(channel.updated_at) ? profile.updated_at : channel.updated_at
    } else {
      updatedAt = profile?.updated_at ?? channel?.updated_at ?? null
    }

    // Scoped service read for knowledge readiness telemetry & counts.
    // Enforces ERROR != EMPTY: table query failures result in null (unavailable), not 0.
    let readiness: OperatorWorkspaceKnowledge['readiness'] = null
    try {
      const untypedAdmin = admin as any
      const [factsRes, candidatesRes, sourcesRes] = await Promise.all([
        untypedAdmin.from('knowledge_facts').select('id, category, created_at', { count: 'exact' }).eq('workspace_id', workspaceId).eq('status', 'active'),
        untypedAdmin.from('knowledge_candidates').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).in('status', ['review_required', 'conflict']),
        untypedAdmin.from('knowledge_sources').select('id, status, created_at').eq('workspace_id', workspaceId),
      ])

      const errors: string[] = []
      if (factsRes?.error) errors.push(`knowledge_facts: ${factsRes.error.message || factsRes.error}`)
      if (candidatesRes?.error) errors.push(`knowledge_candidates: ${candidatesRes.error.message || candidatesRes.error}`)
      if (sourcesRes?.error) errors.push(`knowledge_sources: ${sourcesRes.error.message || sourcesRes.error}`)

      // Facts counts (null if error, number otherwise)
      const factsList = Array.isArray(factsRes?.data) ? factsRes.data : null
      const factsConfirmedCount = factsRes?.error ? null : (factsRes?.count ?? factsList?.length ?? 0)
      const factsPendingCount = candidatesRes?.error ? null : (candidatesRes?.count ?? (Array.isArray(candidatesRes?.data) ? candidatesRes.data.length : 0))

      // Structured facts count (service/menu/price category breakdown, null if factsRes failed)
      let structuredFactsCount: number | null = null
      if (factsList !== null) {
        structuredFactsCount = factsList.filter(
          (f: { category?: string }) => ['MENU', 'PRICE', 'SERVICE', 'HOURS'].includes(String(f.category ?? '').toUpperCase()),
        ).length
      }

      // Materials counts (from single authoritative knowledge_sources table, no cross-level double counting)
      const sourcesList = Array.isArray(sourcesRes?.data) ? sourcesRes.data : null
      let materialsExtractedCount: number | null = null
      let materialsProcessingCount: number | null = null
      let materialsFailedCount: number | null = null
      let materialsTotalCount: number | null = null

      if (sourcesList !== null && !sourcesRes?.error) {
        let extracted = 0
        let processing = 0
        let failed = 0
        for (const s of sourcesList) {
          const st = String(s.status ?? '').toLowerCase()
          if (st === 'approved' || st === 'learned') {
            extracted++
          } else if (['uploading', 'checking', 'registered', 'collection_pending', 'processing'].includes(st)) {
            processing++
          } else if (['failed', 'rejected', 'error', 'conflict', 'paused', 'archived', 'attention'].includes(st)) {
            failed++
          }
        }
        materialsExtractedCount = extracted
        materialsProcessingCount = processing
        materialsFailedCount = failed
        materialsTotalCount = sourcesList.length
      }

      // Compute latest updated_at across readiness tables
      let latestReadinessTime: number | null = updatedAt ? new Date(updatedAt).getTime() : null
      const checkTimestamp = (ts?: string | null) => {
        if (!ts) return
        const t = new Date(ts).getTime()
        if (!Number.isNaN(t) && (latestReadinessTime === null || t > latestReadinessTime)) {
          latestReadinessTime = t
        }
      }

      if (factsList) {
        for (const f of factsList) checkTimestamp(f.created_at)
      }
      if (sourcesList) {
        for (const s of sourcesList) checkTimestamp(s.created_at)
      }

      const lastUpdatedAt = latestReadinessTime ? new Date(latestReadinessTime).toISOString() : updatedAt

      readiness = {
        factsConfirmedCount,
        factsPendingCount,
        materialsExtractedCount,
        materialsProcessingCount,
        materialsFailedCount,
        materialsTotalCount,
        structuredFactsCount,
        productsServicesStatus: 'not_supported',
        telemetry: 'not_collected',
        lastUpdatedAt,
        ...(errors.length > 0 ? { errors } : {}),
      }
    } catch {
      // Readiness query failure must not block the entire knowledge tab
      readiness = null
    }

    const data: OperatorWorkspaceKnowledge = {
      placeUrl,
      placeStatus: channel?.status ?? null,
      businessName: profile?.business_name ?? null,
      industry: profile?.industry ?? null,
      location: profile?.location ?? null,
      summary: profile?.summary ?? null,
      updatedAt,
      readiness,
    }

    const hasAnyInfo = Boolean(
      data.placeUrl || (data.placeStatus && data.placeStatus !== 'disconnected') || data.businessName || data.industry || data.location || data.summary
    )

    return {
      data,
      error: null,
      sourceState: hasAnyInfo ? 'ready' : 'empty',
    }
  } catch (err) {
    return { data: null, error: err }
  }
}

export async function readOperatorWorkspaceDetails(
  workspaceId: string,
  dependencies: Dependencies = {},
): Promise<OperatorWorkspaceDetailReads> {
  const guard = dependencies.requireOperator ?? requireOperator
  const readLifecycle = dependencies.getOperatorOnboardingOverview ?? getOperatorOnboardingOverview
  const readChannels = dependencies.listOperatorChannelConnections ?? listOperatorChannelConnections
  const readPublishing = dependencies.listOperatorPublishOperations ?? listOperatorPublishOperations
  const readBilling = dependencies.listOperatorBillingOverview ?? listOperatorBillingOverview
  const readAudit = dependencies.listOperatorAuditEvents ?? listOperatorAuditEvents
  const readSupport = dependencies.listOperatorSupportSessions ?? listOperatorSupportSessions
  const readCreditConsumptions = dependencies.listWorkspaceCreditConsumptions ?? defaultListCreditConsumptions
  const readKnowledge = dependencies.getOperatorWorkspaceKnowledge ?? getOperatorWorkspaceKnowledge

  const [lifecycle, channels, publishing, billing, support, audit, creditConsumptions, knowledge] = await Promise.all([
    readSection('agreement.read', workspaceId, guard, async () => readLifecycle(workspaceId)),
    readSection('channel.read', workspaceId, guard, async () => readChannels({ workspaceId, limit: 100 })),
    readSection('publish.read', workspaceId, guard, async () => readPublishing({ workspaceId, limit: 50 })),
    readSection('billing.read', workspaceId, guard, async () => readBilling({ workspaceId, limit: 1 })),
    readSection('workspace.support_session.create', workspaceId, guard, async () => readSupport(workspaceId)),
    readSection('audit.read', workspaceId, guard, async () => readAudit({ workspaceId, limit: 20 } as OperatorAuditReadFilters)),
    readSection('billing.read', workspaceId, guard, async () => readCreditConsumptions(workspaceId, 50)),
    readSection('workspace.read', workspaceId, guard, async () => readKnowledge(workspaceId)),
  ])

  return {
    lifecycle,
    channels,
    publishing,
    billing,
    creditConsumptions,
    support,
    audit,
    knowledge,
  }
}
