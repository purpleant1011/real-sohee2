'use client'

import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { ConnectorEntry } from '@/features/marketing-connectors/connector-entry'

export default function ConnectorsPage() {
  const isMobileR2 = useMobileR2Active()

  if (isMobileR2) {
    return (
      <MobileAppShell>
        <ShellScreen mode="DETAIL" title="업무 도구 연결" backHref="/app/system">
          <ConnectorEntry />
        </ShellScreen>
      </MobileAppShell>
    )
  }

  return (
    <V088AppShell>
      <ConnectorEntry />
    </V088AppShell>
  )
}
