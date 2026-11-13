'use client'

import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { MobileCreditView, creditScreenConfig, type CreditViewSnapshot } from './credit-view'

/**
 * M25 요금·크레딧 — R2 셸 배선(ANI-1713, 플래그 뒤).
 * 서버가 이미 읽은 값을 그대로 받아 그리기만 한다. 이 화면은 조회·요청·쓰기를 하지 않는다.
 */
export function R2Credit({ snapshot }: { snapshot: CreditViewSnapshot }) {
  const { mode, title } = creditScreenConfig()
  return (
    <MobileAppShell>
      <ShellScreen mode={mode} title={title}>
        <MobileCreditView snapshot={snapshot} />
      </ShellScreen>
    </MobileAppShell>
  )
}
