import { redirect } from 'next/navigation'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { ContentEntry } from './content-entry'

export const metadata = { title: '콘텐츠 · 소희' }
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ContentPage() {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) {
    redirect('/app/onboarding')
    return null
  }

  return <ContentEntry workspaceId={workspace.workspaceId} />
}
