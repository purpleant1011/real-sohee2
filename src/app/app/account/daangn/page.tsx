import { redirect } from 'next/navigation'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { DaangnBusinessCard } from '@/features/channels/daangn/daangn-business-card'

export default async function DaangnAccountPage() {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) redirect('/app/onboarding')
  return <DaangnBusinessCard profile={{
    accountLabel: null, externalProfileId: null, region: null, introductionState: 'needs_information',
    recentNewsCount: null, capability: 'manual_assist_only', lastVerifiedAt: null,
    reauthState: 'user_login_required',
  }} />
}
