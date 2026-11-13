import { redirect } from 'next/navigation'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { loadTrialSummary } from '@/features/trial-summary/load-trial-summary'
import { TrialSummaryView } from '@/features/trial-summary/trial-summary-view'

export const dynamic = 'force-dynamic'
export const metadata = { title: '체험 요약 · 소희' }

export default async function Page() {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) redirect('/app/onboarding')
  const model = await loadTrialSummary(workspace.workspaceId)
  return <TrialSummaryView model={model} />
}
