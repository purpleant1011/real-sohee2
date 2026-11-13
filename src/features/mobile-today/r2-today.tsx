'use client'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useRouter } from 'next/navigation'
import { useMobileHome } from '@/features/mobile-decision/use-mobile-home'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { TodayLayout } from './today-layout'

/**
 * M09 오늘 — R2 셸에 올린 실흐름 화면(ANI-1770 배선 A, 플래그 뒤).
 * 데이터는 기존 mobile-home 읽기 API 그대로이며 새 쓰기 경로는 없다.
 */
function R2TodayBody({ workspaceId }: { workspaceId: string }) {
  const { view, loading, error, refresh } = useMobileHome(workspaceId)
  // 데스크톱 Dock(ChatPanelProvider)은 R2 셸 밖이므로 쓰지 않고 채팅 화면(M10)으로 이동한다.
  const router = useRouter()
  const openPanel = () => router.push('/app/command?from=' + encodeURIComponent('/app'))
  if (!view) {
    return <div className="space-y-4 pt-3">
      <p role="status" className="text-base text-muted-foreground">{error ? '오늘의 업무를 불러오지 못했어요.' : '매장과 업무 상태를 확인하고 있어요.'}</p>
      {loading ? <Skeleton className="h-48 rounded-[20px]" /> : <Button variant="outline" onClick={refresh} className="min-h-12 rounded-xl">다시 확인하기</Button>}
    </div>
  }
  return <div className="space-y-6 pt-3 pb-8">
    {error && <p role="status" className="rounded-xl border border-border p-4 text-sm text-muted-foreground">새 정보를 불러오지 못했어요. 아래 기록은 이전에 확인한 내용이에요.</p>}
    <TodayLayout
      view={view}
      onRefresh={refresh}
      onDelegate={openPanel}
      workspaceId={workspaceId}
    />
  </div>
}

export function R2Today({ workspaceId }: { workspaceId: string }) {
  return <MobileAppShell>
    <ShellScreen mode="BROWSE" title="오늘">
      <R2TodayBody workspaceId={workspaceId} />
    </ShellScreen>
  </MobileAppShell>
}
