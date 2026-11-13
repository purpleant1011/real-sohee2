import type { ReactNode } from 'react'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { SettingsMasterLayout } from '@/components/v088/system/settings-master-layout'

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <V088AppShell>
      <SettingsMasterLayout>
        {children}
      </SettingsMasterLayout>
    </V088AppShell>
  )
}
