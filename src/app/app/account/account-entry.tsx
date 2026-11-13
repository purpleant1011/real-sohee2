'use client'

import type { ReactNode } from 'react'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { R2Account } from '@/features/mobile-settings/r2-account'
import type { AccountSettingsProp } from '@/features/mobile-settings/account-settings-model'

/**
 * 설정(`/app/account`) 진입점(ANI-1771).
 * 기존 화면은 서버가 그린 children 으로 받는다 — 이 컴포넌트는 다시 조회하지 않는다.
 * 플래그 OFF(기본)·넓은 화면은 기존 V088 계정 화면 그대로다.
 */
export function AccountEntry({ settings, legacy }: Readonly<{ settings: AccountSettingsProp; legacy: ReactNode }>) {
  return useMobileR2Active() ? <R2Account settings={settings} /> : <V088AppShell>{legacy}</V088AppShell>
}
