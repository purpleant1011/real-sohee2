import { redirect } from 'next/navigation'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { BYREUM_IMAGE_HARNESS } from '@/features/harness/byreum-image-harness'
import { isByreumTestAccount, loadActiveByreumImageHarness } from '@/features/harness/byreum-image-harness-repository'
import { ImageStyleSettings } from '@/features/image-style/image-style-settings'
import { loadWorkspaceImageStyle } from '@/features/image-style/workspace-image-style-repository'
import { KnowledgeDashboard } from '@/features/knowledge/knowledge-dashboard'
import { getStudioReadiness } from '@/features/channel-studio/studio-readiness'
import { listKnowledgeItems } from '@/features/knowledge/repository'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export default async function KnowledgePage() {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) redirect('/app/onboarding')

  const result = await listKnowledgeItems(workspace.workspaceId)
  if (result.error) {
    return (
      <section aria-live="assertive" role="alert">
        <h1>지식 자료를 열지 못했어요</h1>
        <p>{result.error.message}</p>
      </section>
    )
  }

  const supabase = await createServerSupabaseClient()
  const user = await supabase.auth.getUser()
  const imageHarness = await loadActiveByreumImageHarness({
    client: supabase,
    workspaceId: workspace.workspaceId,
    channel: 'instagram',
  }).catch(() => null)
  const bundledHarness = !imageHarness && isByreumTestAccount(user.data.user?.email)
    ? BYREUM_IMAGE_HARNESS
    : null
  const studioReadiness = await getStudioReadiness(supabase, workspace.workspaceId)
  const visibleHarness = imageHarness?.harness ?? bundledHarness
  const imageStyle = await loadWorkspaceImageStyle(supabase, workspace.workspaceId)

  return (
    <>
    <KnowledgeDashboard
      activeImageHarness={visibleHarness ? {
        name: visibleHarness.name,
        version: visibleHarness.version,
        channels: visibleHarness.channels,
        approvalStatus: visibleHarness.approval.defaultStatus,
        storageStatus: imageHarness ? 'persisted' : 'bundled',
      } : null}
      items={result.data}
      studioReadiness={studioReadiness}
      role={workspace.role}
      workspaceId={workspace.workspaceId}
    />
    <ImageStyleSettings
      canEdit={workspace.role === 'owner' || workspace.role === 'manager'}
      initialStyle={imageStyle}
      workspaceId={workspace.workspaceId}
    />
    </>
  )
}
