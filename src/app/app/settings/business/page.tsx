import { Sparkles } from 'lucide-react'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { getOperationalSettings } from '@/features/settings/repository'
import { BusinessSettingsForm } from '@/features/settings/settings-form'
import { SettingsSectionHeader } from '@/components/v088/system/settings-section-header'
import { ChannelLearningPanel } from '@/features/channel-learning/components/channel-learning-panel'

const defaultBusinessSettings = {
  businessName: '우리 매장',
  industry: '일반 소상공인 (선택 필요)',
  location: '인천 서구 청라커낼로 260번길 7-11 2층 (센트럴파크 인근)',
  summary: '정성을 다해 고객을 맞이하는 우리 매장 소개글을 입력해 주세요.',
}

export default async function BusinessSettingsPage() {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) {
    return (
      <div className="space-y-6 max-w-4xl">
        <SettingsSectionHeader
          title="가게 기본 정보"
          description="소희가 콘텐츠와 마케팅에 활용할 매장 기본 정보입니다."
        />
        <BusinessSettingsForm canEdit={true} value={defaultBusinessSettings} />
      </div>
    )
  }

  const result = await getOperationalSettings(workspace.workspaceId, workspace.role)
  if (result.error) {
    return (
      <div className="space-y-6 max-w-4xl">
        <SettingsSectionHeader
          title="가게 기본 정보"
          description="소희가 콘텐츠와 마케팅에 활용할 매장 기본 정보입니다."
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
        title="가게 기본 정보"
        description="소희가 콘텐츠와 마케팅에 활용할 매장 기본 정보입니다."
      />
      <BusinessSettingsForm canEdit={result.data.permissions.canEditProfiles} value={result.data.business} />

      {/* 공식 채널 지식 학습 섹션 (가게 정보 메뉴로 통합, SSOT) */}
      <section id="channel-learning" aria-label="공식 채널 지식 학습" className="border-t border-border pt-6 space-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" aria-hidden />
            <h2 className="text-lg font-bold tracking-tight text-foreground">소희에게 내 채널 가르치기</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            운영하시는 공식 채널(인스타그램 등) 주소를 등록하시면, 소희가 매장 정보·메뉴와 가격·말투·사진 스타일을 안전하게 학습하여 답변과 홍보물 제작에 활용해요.
          </p>
        </div>
        <ChannelLearningPanel
          workspaceId={workspace.workspaceId}
          canManage={result.data.permissions.canEditProfiles}
        />
      </section>
    </div>
  )
}
