import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { getOperationalSettings } from '@/features/settings/repository'
import { BrandSettingsForm } from '@/features/settings/settings-form'
import { SettingsSectionHeader } from '@/components/v088/system/settings-section-header'

const defaultBrandSettings = {
  voice: '따뜻하고 신뢰감 있는 전문가 톤, 친근하고 정중한 사장님의 친절한 설명체 (~해요, ~해 드려요)',
  keywords: ['대표 상품·서비스', '1:1 맞춤', '정성 가득한 공간', '동네 단골'],
  prohibitedTerms: ['부작용 없음', '영구 보장', '최저가 보장', '무조건 효과'],
}

export default async function BrandSettingsPage() {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) {
    return (
      <div className="space-y-6 max-w-4xl">
        <SettingsSectionHeader
          title="사진/말투 기준"
          description="저장 뒤 새로 만드는 결과물부터 이 말투와 표현 기준을 사용합니다."
        />
        <BrandSettingsForm canEdit={true} value={defaultBrandSettings} />
      </div>
    )
  }

  const result = await getOperationalSettings(workspace.workspaceId, workspace.role)
  if (result.error) {
    return (
      <div className="space-y-6 max-w-4xl">
        <SettingsSectionHeader
          title="사진/말투 기준"
          description="저장 뒤 새로 만드는 결과물부터 이 말투와 표현 기준을 사용합니다."
        />
        <div role="alert" className="p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-sm text-destructive">
          운영 설정을 열지 못했어요. 잠시 후 다시 확인해 주세요.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <SettingsSectionHeader
        title="사진/말투 기준"
        description="저장 뒤 새로 만드는 결과물부터 이 말투와 표현 기준을 사용합니다."
      />
      <BrandSettingsForm canEdit={result.data.permissions.canEditProfiles} value={result.data.brand} />
    </div>
  )
}
