import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { getOperationalSettings } from '@/features/settings/repository'
import { MemberSettingsList } from '@/features/settings/settings-form'
import { SettingsSectionHeader } from '@/components/v088/system/settings-section-header'

import type { MemberSetting } from '@/features/settings/types'

const defaultMembers: readonly MemberSetting[] = [
  { memberId: 'mem-1', label: '대표님 (owner@example.com)', role: 'owner', status: 'active', current: true },
  { memberId: 'mem-2', label: '소희 AI 마케팅 매니저 (manager@example.com)', role: 'manager', status: 'active', current: false },
]

export default async function MemberSettingsPage() {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) {
    return (
      <div className="space-y-6 max-w-4xl">
        <SettingsSectionHeader
          title="구성원 및 권한"
          description="멤버의 현재 역할과 상태입니다."
        />
        <MemberSettingsList canEdit={true} members={defaultMembers} />
      </div>
    )
  }

  const result = await getOperationalSettings(workspace.workspaceId, workspace.role)
  if (result.error) {
    return (
      <div className="space-y-6 max-w-4xl">
        <SettingsSectionHeader
          title="구성원 및 권한"
          description="멤버의 현재 역할과 상태입니다."
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
        title="구성원 및 권한"
        description="멤버의 현재 역할과 상태입니다. 소유자만 변경할 수 있습니다."
      />
      <MemberSettingsList canEdit={result.data.permissions.canEditMembers} members={result.data.members} />
    </div>
  )
}
