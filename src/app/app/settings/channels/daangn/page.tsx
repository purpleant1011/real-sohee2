import { redirect } from 'next/navigation'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { DaangnBusinessCard } from '@/features/channels/daangn/daangn-business-card'
import { DeviceDashboard } from '@/features/local-publishing/device-dashboard'
import { getConnectorDashboard } from '@/features/local-publishing/device-dashboard-repository'

export default async function DaangnChannelSettingsPage() {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) redirect('/app/onboarding')
  const dashboard = await getConnectorDashboard(workspace.workspaceId)
  const connection = dashboard.connections.find((item) => item.channel === 'daangn_business')
  return <>
    <DaangnBusinessCard profile={{
      accountLabel: connection?.accountLabel ?? null,
      externalProfileId: null,
      region: null,
      introductionState: 'needs_information',
      recentNewsCount: null,
      capability: 'local_connector',
      lastVerifiedAt: connection?.lastSeenAt ?? null,
      reauthState: connection?.status === 'connected' ? 'verification_required' : 'user_login_required',
    }} />
    <DeviceDashboard devices={dashboard.devices} connections={dashboard.connections} />
  </>
}
