import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { ImageStyleSettings } from '@/features/image-style/image-style-settings'
import { loadWorkspaceImageStyle } from '@/features/image-style/workspace-image-style-repository'
import { SettingsSectionHeader } from '@/components/v088/system/settings-section-header'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function ImageStyleSettingsPage() {
  const workspace = await getCurrentWorkspaceContext()
  const supabase = workspace ? await createServerSupabaseClient() : null
  const style = workspace && supabase ? await loadWorkspaceImageStyle(supabase, workspace.workspaceId) : null

  return (
    <div className="space-y-6 max-w-4xl">
      <SettingsSectionHeader
        title="이미지 스타일"
        description="참고 사진과 원하는 느낌을 알려 주면 소희가 만드는 모든 이미지가 그 느낌을 따라요."
      />
      {workspace ? (
        <ImageStyleSettings
          canEdit={workspace.role === 'owner' || workspace.role === 'manager'}
          initialStyle={style}
          workspaceId={workspace.workspaceId}
        />
      ) : (
        <p className="text-sm text-muted-foreground">가게를 먼저 등록해 주세요.</p>
      )}
    </div>
  )
}
