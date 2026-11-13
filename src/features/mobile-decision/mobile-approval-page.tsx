'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useWorkspaceId } from '@/hooks/use-workspace-context'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { Button } from '@/components/ui/button'
import { MobileApprovalScreen } from './mobile-approval-view'
import { mobileApprovalSchema } from './schemas'
import { approvalKey, safeReturnPath } from './selectors'
import { useMobileHome } from './use-mobile-home'
import type { MobileApprovalView } from './contracts'
import { consumeDecisionReturn, rememberDecisionClick, useRestoreDecisionPosition } from './decision-return'

function ApprovalList({ workspaceId }: { workspaceId: string }) {
  const { view, error, refresh } = useMobileHome(workspaceId)
  useRestoreDecisionPosition(workspaceId, Boolean(view?.decisions.data))
  return <div className="mx-auto max-w-2xl space-y-5 pb-6">
    <Link prefetch={false} href="/app" className="inline-flex min-h-11 items-center text-sm text-primary">오늘로 돌아가기</Link>
    <h1 className="text-2xl font-semibold tracking-tight">확인할 작업</h1>
    <p className="text-base text-muted-foreground">저장된 내용을 검토해요. 여기에서는 게시·답장·예약을 실행하지 않아요.</p>
    {(error || view?.decisions.state === 'error') && <p role="status" className="rounded-xl border border-border p-4 text-sm">작업 목록을 모두 확인하지 못했어요. 조회가 실패했다고 해서 확인할 일이 없는 것은 아니에요.</p>}
    {!view && !error && <p role="status">작업 목록을 불러오고 있어요.</p>}
    {view?.decisions.data?.items.map(item => <Link prefetch={false} key={item.id} id={`mobile-decision-${item.id}`} onClick={event => rememberDecisionClick(event, workspaceId, item.id)} href={`/app/approvals?item=${encodeURIComponent(item.id)}`} className="flex min-h-20 flex-col justify-center gap-1 rounded-2xl border border-border bg-card p-4 focus-visible:outline-2 focus-visible:outline-ring"><span className="text-base font-semibold">{item.title}</span><span className="text-sm text-muted-foreground">{item.targetLabel} · 내용 검토</span></Link>)}
    {view?.decisions.data?.complete && view.decisions.data.total === 0 && <p className="rounded-2xl bg-muted p-5">지금 확인하실 일은 없어요</p>}
    <div className="flex flex-wrap gap-3"><Link prefetch={false} href="/app/content" className="inline-flex min-h-11 items-center text-sm text-primary">콘텐츠 전체 목록</Link><Link prefetch={false} href="/app/engagement" className="inline-flex min-h-11 items-center text-sm text-primary">소통함 전체 목록</Link></div>
    <Button variant="outline" onClick={refresh} className="min-h-11">다시 확인하기</Button>
  </div>
}
function ApprovalDetail({ workspaceId, item }: { workspaceId: string; item: string }) {
  const router = useRouter()
  const [reload, setReload] = useState(0)
  const [state, setState] = useState<{ key: string; view: MobileApprovalView | null; error: string | null }>({ key: '', view: null, error: null })
  const key = `${workspaceId}/${item}/${reload}`
  useEffect(() => {
    const controller = new AbortController()
    if (!approvalKey(item)) return () => controller.abort()
    void fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/mobile-approvals/${encodeURIComponent(item)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('조회 실패')
        const view = mobileApprovalSchema.parse(await response.json())
        if (view.workspaceId !== workspaceId || view.id !== item) throw new Error('작업 확인 필요')
        if (!controller.signal.aborted) setState({ key, view, error: null })
      }).catch(() => { if (!controller.signal.aborted) setState({ key, view: null, error: '작업을 불러오지 못했어요. 다시 확인해 주세요.' }) })
    return () => controller.abort()
  }, [workspaceId, item, key])
  function back() {
    const previousRoute = consumeDecisionReturn(workspaceId, item)
    if (previousRoute) {
      if (history.length > 1) router.back()
      else router.replace(previousRoute)
      return
    }
    try {
      const previous = new URL(document.referrer)
      const value = previous.pathname + previous.search
      if (previous.origin === location.origin && safeReturnPath(value) === value) { router.back(); return }
    } catch { /* Direct links have no trusted return entry. */ }
    router.replace('/app/approvals')
  }
  const current = state.key === key ? state : null
  if (!current?.view) return <div className="mx-auto max-w-2xl space-y-5 pb-6"><h1 className="text-2xl font-semibold">내용 검토</h1><p role="status">{current?.error || (!approvalKey(item) ? '이 작업을 확인할 수 없어요.' : '전체 내용을 확인하고 있어요.')}</p><Button variant="outline" onClick={() => setReload(value => value + 1)} className="min-h-11">다시 확인하기</Button><Button variant="ghost" onClick={back} className="min-h-11">목록으로 돌아가기</Button></div>
  return <MobileApprovalScreen view={current.view} onBack={back} onRefresh={() => setReload(value => value + 1)} />
}
export function MobileApprovalPage() {
  const workspaceId = useWorkspaceId()
  const params = useSearchParams()
  const item = params?.get('item') || null
  return <V088AppShell workspaceId={workspaceId}>{item ? <ApprovalDetail workspaceId={workspaceId} item={item} /> : <ApprovalList workspaceId={workspaceId} />}</V088AppShell>
}
