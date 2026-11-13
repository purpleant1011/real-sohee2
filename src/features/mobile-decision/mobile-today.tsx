'use client'

import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { useChatPanel } from '@/features/agent-dock/chat-panel-store'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MobileHomeView } from './mobile-home-view'
import { useMobileHome } from './use-mobile-home'

function MobileTodayContent({ workspaceId }: { workspaceId: string }) {
  const { view, loading, error, refresh } = useMobileHome(workspaceId)
  const { openPanel } = useChatPanel()
  if (!view) return <div className="mx-auto max-w-2xl space-y-4" role="status">
    <h1 className="text-2xl font-semibold">오늘, 소희와 함께</h1>
    <p className="text-base text-muted-foreground">{error ? '오늘의 업무를 불러오지 못했어요.' : '매장과 업무 상태를 확인하고 있어요.'}</p>
    {loading ? <Skeleton className="h-48 rounded-2xl" /> : <Button variant="outline" onClick={refresh} className="min-h-12">다시 확인하기</Button>}
  </div>
  return <>{error && <p role="status" className="mx-auto mb-4 max-w-2xl rounded-xl border border-border p-4 text-sm">새 정보를 불러오지 못했어요. 아래 기록은 이전에 확인한 내용이에요.</p>}
    <MobileHomeView view={view} onRefresh={refresh} onDelegate={openPanel} /></>
}
export function MobileToday({ workspaceId }: { workspaceId: string }) {
  return <V088AppShell workspaceId={workspaceId}><MobileTodayContent workspaceId={workspaceId} /></V088AppShell>
}
