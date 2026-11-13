import { requireOperator } from '../../../../features/operator-auth/require-operator'
import { getOperatorWorkspace } from '../../../../features/operator-workspaces/repository'
import { readOperatorWorkspaceDetails } from '../../../../features/operator-workspaces/detail-read-orchestrator'
import { resolveWorkspaceBusinessInfo } from '../../../../features/operator-workspaces/business-info-resolver'
import { getWorkspaceAuthoritativeCreditBalance } from '../../../../features/credits/actual-spend-balance.server'
import { DynamicWorkspaceDetail } from '../../../../features/operator-refine/operator-dynamic-views'
import { AdminCustomer360Detail } from '../../../../components/v089/admin-customer-360-detail'
import { LoadErrorNotice, MfaRequiredNotice } from '../../../../components/admin-ui/data-state'
import { createAdminSupabaseClient } from '../../../../lib/supabase/admin'

type Props = Readonly<{ params: Promise<{ workspaceId: string }> }>

/**
 * Total available credits resolution:
 * Strictly relies on the authoritative spend balance RPC (matching reserve_quick_post_credits exact conditions).
 * If the authoritative RPC fails or returns null, returns null to trigger LoadErrorNotice (no legacy inflated fallback).
 */
export function resolveCreditTotal(
  authAvailable: number | null | undefined,
): number | null {
  if (typeof authAvailable === 'number' && Number.isFinite(authAvailable)) return authAvailable
  return null
}

export default async function OperatorWorkspaceDetailPage({ params }: Props) {
  const { workspaceId } = await params
  await requireOperator('workspace.read', workspaceId)
  const result = await getOperatorWorkspace(workspaceId)
  if (result.error !== null) {
    return (
      <section aria-labelledby="operator-workspace-detail-title" className="space-y-3 p-6">
        <h1 id="operator-workspace-detail-title" className="text-xl font-bold">고객사 상세</h1>
        {result.error === 'MFA_REQUIRED'
          ? <MfaRequiredNotice />
          : <LoadErrorNotice what="고객사 상세" retryHref={`/admin/workspaces/${workspaceId}`} />}
      </section>
    )
  }

  // Direct table reads run after the operator guard with the service client (the session client is
  // RLS-filtered to the operator's own workspace) and are always scoped to this workspace.
  const admin = createAdminSupabaseClient() as unknown as { from(table: string): any; rpc(name: string, args: any): any }
  const [businessInfo, reads, authBalance] = await Promise.all([
    resolveWorkspaceBusinessInfo(workspaceId, admin),
    readOperatorWorkspaceDetails(workspaceId),
    getWorkspaceAuthoritativeCreditBalance(workspaceId, admin),
  ])
  const creditTotal = resolveCreditTotal(authBalance?.authoritativeAvailableCredits)

  const isQueryError = businessInfo.status === 'QUERY_ERROR'
  const isNotSubmitted = businessInfo.status === 'NOT_SUBMITTED'
  const verificationUnknown = isQueryError || isNotSubmitted

  const resolvedVerificationStatus: 'VERIFIED' | 'REJECTED' | 'PENDING' | undefined =
    businessInfo.status === 'VERIFIED'
      ? 'VERIFIED'
      : businessInfo.status === 'REJECTED'
      ? 'REJECTED'
      : businessInfo.status === 'SUBMITTED_PENDING'
      ? 'PENDING'
      : undefined

  // Synchronize availableCredits across header, metric tiles, and billing tab to authoritative spend balance
  const synchronizedSummary = {
    ...result.data,
    availableCredits: creditTotal,
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {isQueryError ? <LoadErrorNotice what="사업자 심사 정보" retryHref={`/admin/workspaces/${workspaceId}`} /> : null}
      {creditTotal === null ? <LoadErrorNotice what="크레딧 잔액" retryHref={`/admin/workspaces/${workspaceId}`} /> : null}

      <AdminCustomer360Detail
        initialData={{
          workspaceId,
          companyName:
            businessInfo.companyName.value ||
            result.data.businessName ||
            result.data.workspaceName,
          representativeName: businessInfo.representativeName.value || undefined,
          businessNumber: businessInfo.businessNumber.value || undefined,
          businessVerificationStatus: resolvedVerificationStatus,
          creditBalance: creditTotal === null ? undefined : { activation: 0, agent: 0, protectedWow: 0, purchased: 0, total: creditTotal },
        }}
        verificationUnknown={verificationUnknown}
      />

      <DynamicWorkspaceDetail summary={synchronizedSummary} reads={reads} businessInfo={businessInfo} />
    </div>
  )
}

