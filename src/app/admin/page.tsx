export const dynamic = 'force-dynamic'
export const revalidate = 0

import { requireOperatorAnyScope } from '../../features/operator-auth/require-operator'
import { listOperatorWorkspaces } from '../../features/operator-workspaces/repository'
import { getOperatorOnboardingOverview } from '../../features/operator-onboarding/lifecycle-repository'
import { listOperatorChannelConnections } from '../../features/operator-channels/repository'
import { listOperatorPublishOperations } from '../../features/operator-publishing/publish-read-repository'
import { listOperatorBillingOverview } from '../../features/operator-billing/billing-read-repository'
import { listOperatorAuditEvents } from '../../features/operator-audit/audit-read-repository'
import { listOperatorSupportSessions } from '../../features/operator-support/support-session-repository'
import { getOperatorSystemObservations } from '../../features/operator-system/repository'
import { ControlTowerView } from '../../features/operator-control-tower/control-tower-view'
import { buildOperatorHome } from '../../features/operator-control-tower/operator-home'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 1800, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timer!)
  }
}

type Settled<T> = PromiseSettledResult<Readonly<{ data: T | null; error: unknown }>>

function dataOf<T>(result: Settled<T>): T | null {
  return result.status === 'fulfilled' && result.value.error === null ? result.value.data : null
}

export default async function OperatorPage() {
  await requireOperatorAnyScope('dashboard.read')

  const fetchMemberships = async () => {
    try {
      const adminClient = createAdminSupabaseClient()
      const { data, error } = await (adminClient as any).rpc('workspace_membership_overview')
      if (error || !Array.isArray(data)) {
        return { data: null, error: error ?? 'MEMBERSHIP_OVERVIEW_ERROR' }
      }
      let formalCount = 0
      let applicantCount = 0
      for (const row of data as Array<{ is_formal?: boolean }>) {
        if (row.is_formal) formalCount++
        else applicantCount++
      }
      return { data: { formalCount, applicantCount }, error: null }
    } catch (err) {
      return { data: null, error: err }
    }
  }

  const [workspaces, lifecycle, channels, publishing, billing, audit, support, system, memberships] = await Promise.allSettled([
    withTimeout(listOperatorWorkspaces({ cursor: null, query: null, status: null, limit: 100 }), 4000, { data: null, error: 'WORKSPACE_LIST_UNAVAILABLE' as never }),
    withTimeout(getOperatorOnboardingOverview(), 4000, { data: null, error: 'LIFECYCLE_UNAVAILABLE' as never }),
    withTimeout(listOperatorChannelConnections({ limit: 100 }), 4000, { data: null, error: 'CHANNEL_LIST_UNAVAILABLE' as never }),
    withTimeout(listOperatorPublishOperations({ limit: 100 }), 4000, { data: null, error: 'PUBLISH_LIST_UNAVAILABLE' as never }),
    withTimeout(listOperatorBillingOverview({ limit: 100 }), 4000, { data: null, error: 'BILLING_LIST_UNAVAILABLE' as never }),
    withTimeout(listOperatorAuditEvents({ limit: 10 }), 4000, { data: null, error: 'AUDIT_READ_UNAVAILABLE' as never }),
    withTimeout(listOperatorSupportSessions(), 4000, { data: null, error: 'SUPPORT_SESSION_UNAVAILABLE' as never }),
    withTimeout(getOperatorSystemObservations(), 4000, { data: null, error: 'SYSTEM_UNAVAILABLE' as never }),
    withTimeout(fetchMemberships(), 4000, { data: null, error: 'MEMBERSHIP_TIMEOUT' }),
  ])

  const workspacesData = dataOf(workspaces)
  const lifecycleData = dataOf(lifecycle)
  const channelsData = dataOf(channels)
  const publishingData = dataOf(publishing)
  const billingData = dataOf(billing)
  const auditData = dataOf(audit)
  const supportData = dataOf(support)
  const systemData = dataOf(system)
  const membershipsData = dataOf(memberships)
  const now = new Date()

  const home = buildOperatorHome({
    workspaces: workspacesData && {
      truncated: workspacesData.nextCursor !== null,
      items: workspacesData.items.map((w) => ({ workspaceId: w.workspaceId, workspaceName: w.workspaceName, workspaceKind: w.workspaceKind, lifecycleStatus: w.lifecycleStatus })),
    },
    memberships: membershipsData,
    onboarding: lifecycleData && lifecycleData.map((o) => ({ workspaceId: o.workspaceId, workspaceName: o.workspaceName, lifecycleStatus: o.lifecycle.data?.status ?? null, changedAt: o.lifecycle.data?.changedAt ?? null })),
    channels: channelsData && {
      truncated: channelsData.length >= 100,
      items: channelsData.map((c) => ({ workspaceId: c.workspaceId, workspaceName: c.workspaceName, channel: c.channel, connectionStatus: c.connectionStatus })),
    },
    publishing: publishingData && {
      truncated: publishingData.nextCursor !== null,
      items: publishingData.items.map((p) => ({ workspaceId: p.workspaceId, workspaceName: p.workspaceName, channel: p.channel, contentTitle: p.contentTitle, displayState: p.displayState, publishedAt: p.publishedAt, publishAt: p.publishAt })),
    },
    billing: billingData && {
      truncated: billingData.items.length >= 100,
      items: billingData.items.map((b) => ({ workspaceId: b.workspace_id, workspaceName: b.workspace_name, available: b.balance.available, weeklyLimit: b.entitlement.weekly_limit })),
    },
    audit: auditData && {
      items: auditData.items.map((e) => ({ id: e.id, action: e.action, workspaceName: e.workspaceName, result: e.result, createdAt: e.createdAt })),
    },
    support: supportData && {
      truncated: supportData.length >= 50,
      items: supportData.map((s) => ({ workspaceId: s.workspaceId, status: s.status, startedAt: s.startedAt, expiresAt: s.expiresAt })),
    },
    system: systemData && { items: systemData.items.map((s) => ({ source: s.source, state: s.state })) },
  }, now)

  return <ControlTowerView home={home} now={now} />
}
