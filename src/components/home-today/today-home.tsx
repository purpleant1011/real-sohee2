'use client'

import dynamic from 'next/dynamic'
import { useMobileUi } from '@/features/mobile-decision/mobile-ui-provider'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { R2Today } from '@/features/mobile-today/r2-today'
import type { HomeDisplayDensity } from './home-display-density'

const LegacyTodayHome = dynamic(() => import('./legacy-today-home').then(module => module.LegacyTodayHome), {
  loading: HomeCodeLoading,
})
const PcTodayHome = dynamic(() => import('./pc/pc-today-home').then(module => module.PcTodayHome), {
  loading: HomeCodeLoading,
})
const MobileToday = dynamic(() => import('@/features/mobile-decision/mobile-today').then(module => module.MobileToday), {
  loading: HomeCodeLoading,
})

function HomeCodeLoading() {
  return <section className="p-4"><h1 className="text-xl font-semibold">사장님, 오늘도 소희가 함께해요</h1><p role="status" className="mt-2 text-sm text-muted-foreground">오늘 화면을 준비하고 있어요.</p></section>
}

export function TodayHome({ workspaceId, initialDensity = 'compact' }: { workspaceId: string; initialDensity?: HomeDisplayDensity }) {
  const r2 = useMobileR2Active()
  const { enabled } = useMobileUi()
  const mobile = useMediaQuery('(max-width: 767px)')
  if (r2) return <R2Today key={workspaceId} workspaceId={workspaceId} />
  if (enabled && mobile) return <MobileToday key={workspaceId} workspaceId={workspaceId} />
  // 새 PC 3열 홈이 기본이다(기존 PC 홈의 안전 제어·승인 센터·보관함 등을 모두 담는다). NEXT_PUBLIC_PC_HOME_V2=0 이면 기존 홈으로 되돌린다.
  if (!mobile && process.env.NEXT_PUBLIC_PC_HOME_V2 !== '0') return <PcTodayHome key={workspaceId} workspaceId={workspaceId} initialDensity={initialDensity} />
  return <LegacyTodayHome key={workspaceId} workspaceId={workspaceId} initialDensity={initialDensity} />
}
