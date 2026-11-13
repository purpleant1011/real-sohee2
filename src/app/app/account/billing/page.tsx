import { BillingView } from '@/features/billing/billing-view'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { listCheckoutIntents } from '@/features/billing/repository'
import { redirect } from 'next/navigation'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { SettingsMasterLayout } from '@/components/v088/system/settings-master-layout'
import { SettingsSectionHeader } from '@/components/v088/system/settings-section-header'

export default async function BillingPage() {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) redirect('/app/onboarding')
  const intents = await listCheckoutIntents(workspace.workspaceId)

  return (
    <V088AppShell>
      <SettingsMasterLayout>
        <div className="space-y-6 max-w-4xl">
          <SettingsSectionHeader
            title="요금제 및 결제"
            description="결제 기능을 준비하고 있어요. 원하는 요금제를 미리 확인해 두실 수 있어요."
          />
          <BillingView intents={intents.data ?? []} />
        </div>
      </SettingsMasterLayout>
    </V088AppShell>
  )
}
