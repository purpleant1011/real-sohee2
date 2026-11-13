import { notFound, redirect } from 'next/navigation'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { ContentEditor } from '@/features/content/content-editor'
import { getContentDetail, listConfirmedContentMedia } from '@/features/content/repository'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'

export default async function EditWorkPage({
  params,
}: Readonly<{ params: Promise<{ contentId: string }> }>) {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) redirect('/app/onboarding')
  if (workspace.role === 'viewer') redirect('/app/work')

  const { contentId } = await params
  const [detailResult, mediaResult] = await Promise.all([
    getContentDetail(workspace.workspaceId, contentId),
    listConfirmedContentMedia(workspace.workspaceId),
  ])

  if (detailResult.error?.requestId === 'content-not-found') notFound()
  if (detailResult.error || mediaResult.error) throw new Error('CONTENT_EDITOR_UNAVAILABLE')

  return (
    <V088AppShell workspaceId={workspace.workspaceId}>
      <ContentEditor
        workspaceId={workspace.workspaceId}
        detail={detailResult.data}
        media={mediaResult.data}
      />
    </V088AppShell>
  )
}
