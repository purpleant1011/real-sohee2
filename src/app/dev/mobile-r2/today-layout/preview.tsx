'use client'

import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { EXAMPLE_HOME } from '@/features/mobile-today/example-today-screen'
import { TodayLayout } from '@/features/mobile-today/today-layout'

export function TodayLayoutPreview() {
  return (
    <MobileAppShell>
      <ShellScreen mode="BROWSE" title="오늘">
        <div className="space-y-6 pt-3 pb-8">
          <TodayLayout view={EXAMPLE_HOME} onRefresh={() => {}} onDelegate={() => {}} workspaceId="preview-workspace" />
        </div>
      </ShellScreen>
    </MobileAppShell>
  )
}
