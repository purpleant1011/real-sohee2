'use client'

import { MobileAppShell, ShellScreen, type ShellScreenConfig } from '@/features/mobile-shell'
import { AutonomyControl } from '@/features/mobile-today/autonomy-control'
import { useAutonomy } from '@/features/mobile-today/use-autonomy'

export function autonomyScreenConfig(): ShellScreenConfig {
  return { mode: 'DETAIL', title: '자율근무' }
}

/**
 * M24 자율근무 — R2 셸 배선(ANI-1712, 플래그 뒤).
 * 표시와 중지·재개는 `/agent/control` 서버 readback(actualMode/version)만 근거로 한다.
 * 로컬 토글로 "중지됨"을 먼저 보여주지 않는다. 킬스위치·BLOCKED 는 화면에서 멈춘 상태로만 보인다.
 */
export function R2Autonomy({ workspaceId }: { workspaceId: string }) {
  const controller = useAutonomy(workspaceId)
  const { mode, title } = autonomyScreenConfig()
  return (
    <MobileAppShell>
      <ShellScreen mode={mode} title={title}>
        <div className="mx-auto w-full max-w-2xl space-y-4 pt-2">
          <AutonomyControl controller={controller} />
          <p className="px-1 text-sm leading-relaxed text-muted-foreground">
            중지하면 새 작업을 시작하지 않아요. 이미 진행 중인 작업은 서버가 확인한 뒤 표시가 바뀝니다.
          </p>
        </div>
      </ShellScreen>
    </MobileAppShell>
  )
}
