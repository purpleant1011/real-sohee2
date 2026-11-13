'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { MasterDetail } from '@/components/layout/master-detail'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { Button } from '@/components/ui/button'
import { StateView, StatusPill } from '@/components/mobile-ui'
import { useWorkspaceId } from '@/hooks/use-workspace-context'
import { useMobileHome } from '@/features/mobile-decision/use-mobile-home'
import { mobileApprovalSchema } from '@/features/mobile-decision/schemas'
import { approvalKey, confirmedEmpty } from '@/features/mobile-decision/selectors'
import type { MobileApprovalView } from '@/features/mobile-decision/contracts'
import { ReplyApprovalActions } from '@/features/mobile-approvals/reply-approval-actions'
import { PostApprovalContinuation } from '@/features/mobile-approvals/post-approval-continuation'
import { cn } from '@/lib/utils'

export function PcApprovalsView() {
  const workspaceId = useWorkspaceId()
  const searchParams = useSearchParams()
  const selectedItem = searchParams?.get('item') || null

  const { view, loading, error, refresh } = useMobileHome(workspaceId)
  const decisions = view?.decisions
  const items = useMemo(() => decisions?.data?.items ?? [], [decisions?.data?.items])
  const empty = decisions ? confirmedEmpty(decisions) : false
  const incomplete = Boolean(error || decisions?.state === 'error' || decisions?.state === 'unknown' || decisions?.state === 'stale')

  const listContent = (
    <div className="space-y-4 pr-1">
      <header className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight text-foreground">확인할 작업</h1>
        <p className="text-xs text-muted-foreground">저장된 내용을 검토하고 확정해요.</p>
      </header>

      {incomplete ? (
        <StateView
          kind="error"
          title="작업 목록을 불러오지 못했어요"
          action={
            <Button variant="outline" size="sm" onClick={refresh} className="min-h-11">
              <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
              다시 확인하기
            </Button>
          }
        />
      ) : !view && loading ? (
        <StateView kind="loading" skeleton="list" skeletonRows={4} />
      ) : items.length ? (
        <ul className="space-y-2.5" role="list">
          {items.map((item) => {
            const isSelected = item.id === selectedItem
            return (
              <li key={item.id}>
                <Link
                  prefetch={false}
                  href={`/app/approvals?item=${encodeURIComponent(item.id)}`}
                  aria-current={isSelected ? 'true' : undefined}
                  className={cn(
                    'flex flex-col gap-1.5 rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                    isSelected
                      ? 'border-primary bg-primary/5 shadow-xs'
                      : 'border-border bg-card hover:border-primary/40'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {item.title}
                    </span>
                    <StatusPill kind="review" label="내용 검토" />
                  </div>
                  <span className="truncate text-xs text-muted-foreground">
                    {item.targetLabel || '대상 확인 필요'}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      ) : empty ? (
        <StateView
          kind="confirmed_empty"
          title="확인할 작업이 없어요"
          description="새 글을 소희에게 맡겨 보세요."
          action={
            <Button asChild variant="outline" className="min-h-11 w-full">
              <Link href="/app">오늘로 돌아가기</Link>
            </Button>
          }
        />
      ) : null}
    </div>
  )

  const detailContent = selectedItem ? (
    <PcApprovalDetailPane
      key={`${workspaceId}:${selectedItem}`}
      workspaceId={workspaceId}
      item={selectedItem}
      fallbackItem={items.find((i) => i.id !== selectedItem) ?? items[0] ?? null}
    />
  ) : null

  return (
    <V088AppShell workspaceId={workspaceId}>
      <div className="mx-auto w-full max-w-6xl py-4 sm:py-6 pb-20">
        <MasterDetail
          listLabel="승인 대기 목록"
          detailLabel="승인 작업 상세"
          list={listContent}
          detail={detailContent}
          emptyDetail={<p className="text-sm text-muted-foreground">왼쪽에서 하나를 골라 보세요.</p>}
          hasSelection={Boolean(selectedItem)}
        />
      </div>
    </V088AppShell>
  )
}

function PcApprovalDetailPane({
  workspaceId,
  item,
  fallbackItem,
}: {
  workspaceId: string
  item: string
  fallbackItem?: { id: string; title: string } | null
}) {
  const invalidKey = !approvalKey(item)
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(!invalidKey)
  const [view, setView] = useState<MobileApprovalView | null>(null)
  const [error, setError] = useState<string | null>(invalidKey ? '이 작업을 확인할 수 없어요.' : null)

  useEffect(() => {
    if (invalidKey) return

    let cancelled = false
    const controller = new AbortController()

    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/mobile-approvals/${encodeURIComponent(item)}`,
      { cache: 'no-store', signal: controller.signal }
    )
      .then(async (res) => {
        if (!res.ok) throw new Error('조회 실패')
        const data = await res.json()
        const parsed = mobileApprovalSchema.parse(data)
        if (parsed.workspaceId !== workspaceId || parsed.id !== item) {
          throw new Error('작업 확인 필요')
        }
        if (!cancelled) {
          setError(null)
          setView(parsed)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled && !controller.signal.aborted) {
          setError(err?.message || '작업을 불러오지 못했어요. 다시 확인해 주세요.')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [workspaceId, item, invalidKey, reload])

  if (loading) {
    return <StateView kind="loading" skeleton="detail" skeletonRows={4} />
  }

  if (error || !view) {
    return (
      <StateView
        kind="error"
        title={error ?? '작업을 불러오지 못했어요.'}
        description={
          invalidKey
            ? '이전 작업 링크이거나 더 이상 지원하지 않는 형식이에요. 대기 중인 작업을 다시 선택해 주세요.'
            : undefined
        }
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            {fallbackItem ? (
              <Button asChild size="sm" className="min-h-11">
                <Link href={`/app/approvals?item=${encodeURIComponent(fallbackItem.id)}`}>
                  대기 중인 작업 확인하기
                </Link>
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm" className="min-h-11">
                <Link href="/app/approvals">목록으로 돌아가기</Link>
              </Button>
            )}
            {!invalidKey && (
              <Button variant="outline" size="sm" onClick={() => setReload((v) => v + 1)} className="min-h-11">
                <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
                다시 확인하기
              </Button>
            )}
          </div>
        }
      />
    )
  }

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-2xs mb-10">
      <header className="space-y-2 border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill kind="review" label="내용 검토" />
          <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {view.datasetMode === 'TEST' || view.datasetMode === 'DEMO'
              ? '예시 검토'
              : '최종 승인'}
          </span>
        </div>
        <h2 className="break-words text-xl font-bold tracking-tight text-foreground">
          {view.title}
        </h2>
        <p className="text-xs text-muted-foreground">{view.targetLabel || '대상 확인 필요'}</p>
      </header>

      {/* 고객 원문 */}
      <section aria-label="고객 원문" className="space-y-1.5">
        <h3 className="text-sm font-semibold text-foreground">고객 원문</h3>
        <div className="whitespace-pre-wrap break-words rounded-xl border border-border bg-muted/40 p-4 text-sm leading-relaxed text-foreground">
          {view.sourceText || '원본 내용을 아직 확인하지 못했어요.'}
        </div>
      </section>

      {/* 실행 액션: 기존 컴포넌트 재사용 */}
      {view.datasetMode === 'ACTUAL' && (view.kind === 'dm_reply' || view.kind === 'comment_reply') ? (
        <ReplyApprovalActions workspaceId={workspaceId} item={item} />
      ) : view.datasetMode === 'ACTUAL' && view.kind === 'post_publish' ? (
        <PostApprovalContinuation item={view.id} workspaceId={workspaceId} />
      ) : (
        <section aria-label="전체 초안" className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">소희 추천 내용</h3>
          <div className="whitespace-pre-wrap break-words rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm leading-relaxed text-foreground">
            {view.fullContent || '준비된 초안이 없습니다.'}
          </div>
          <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 text-primary shrink-0" aria-hidden="true" />
            <span>내용 확인 후 바로 확정할 수 있습니다.</span>
          </div>
        </section>
      )}
    </div>
  )
}
