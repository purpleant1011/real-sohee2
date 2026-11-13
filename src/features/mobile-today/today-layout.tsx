'use client'

import Link from 'next/link'
import { ChevronRight, Globe } from 'lucide-react'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { useAutonomy } from '@/features/mobile-today/use-autonomy'
import { HomeStatusPill } from '@/features/mobile-today/home-status-pill'
import { DecisionHero } from '@/features/mobile-today/decision-hero'
import { DelegateBar } from '@/features/mobile-today/delegate-bar'
import { QuickActions } from '@/features/mobile-today/quick-actions'
import { TodayActivityCard } from '@/features/mobile-today/today-activity-card'
import { MagicPhotoDropzone } from '@/components/home-today/magic-photo-dropzone'
import type { MobileHomeDto } from '@/features/mobile-decision/contracts'
import { useRestoreDecisionPosition } from '@/features/mobile-decision/decision-return'

function day(view: MobileHomeDto): string {
  if (!view.timeZone) return '매장 시간대 확인 필요'
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: view.timeZone,
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(new Date(view.generatedAt))
  } catch {
    return '날짜 확인 필요'
  }
}

export interface TodayLayoutProps {
  view: MobileHomeDto
  onRefresh: () => void
  onDelegate: () => void
  workspaceId: string
}

export function TodayLayout({ view, onRefresh, onDelegate, workspaceId }: TodayLayoutProps) {
  useRestoreDecisionPosition(view.workspaceId, view.decisions.data !== null)
  const controller = useAutonomy(view.workspaceId)
  const isR2Active = useMobileR2Active()
  const autonomyHref = isR2Active
    ? '/app/account/automation'
    : '/app/sohee?tab=work&section=autonomy'

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 pb-6 text-foreground">
      {/* 1. 헤더: 날짜·매장 + 소희 상태 한 줄 */}
      <header className="flex items-center justify-between gap-3 pt-1">
        <h1 className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          {day(view)}{view.businessName ? ` · ${view.businessName}` : ''}
        </h1>
        <div className="shrink-0">
          <HomeStatusPill controller={controller} autonomyHref={autonomyHref} />
        </div>
      </header>

      {/* 2. DecisionHero */}
      <DecisionHero view={view} onRefresh={onRefresh} />

      {/* 3. DelegateBar */}
      <DelegateBar onDelegate={onDelegate} />

      {/* 4. MagicPhotoDropzone */}
      <MagicPhotoDropzone workspaceId={workspaceId} />

      {/* 4-1. 매장 공식 채널 지식 학습 배너 */}
      <Link
        href="/app/settings/business#channel-learning"
        prefetch={false}
        className="flex items-center justify-between p-3.5 rounded-2xl border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors group"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Globe className="size-4.5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground truncate">소희에게 내 채널 가르치기</p>
            <p className="text-xs text-muted-foreground truncate">인스타그램·스레드 등록하고 맞춤 지식 학습</p>
          </div>
        </div>
        <ChevronRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
      </Link>

      {/* 5. QuickActions */}
      <QuickActions />

      {/* 6. TodayActivityCard */}
      <TodayActivityCard view={view} onRefresh={onRefresh} />
    </div>
  )
}
