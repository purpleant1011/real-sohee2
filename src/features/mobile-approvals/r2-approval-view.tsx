'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StateView, StatusPill } from '@/components/mobile-ui'
import { ShellScreen, type ShellScreenConfig } from '@/features/mobile-shell'
import { mobileApprovalSchema } from '@/features/mobile-decision/schemas'
import { approvalKey, confirmedEmpty, safeReturnPath } from '@/features/mobile-decision/selectors'
import { consumeDecisionReturn } from '@/features/mobile-decision/decision-return'
import { useMobileHome } from '@/features/mobile-decision/use-mobile-home'
import type { MobileApprovalView } from '@/features/mobile-decision/contracts'
import { mobileApprovalV2Schema, toMobileApprovalV1, type MobileApprovalViewV2 } from './contracts'
import { resolveApprovalCta } from './cta'
import { ReplyApprovalActions } from './reply-approval-actions'
import { PostApprovalContinuation } from './post-approval-continuation'

/** M19 목록은 5탭을 유지하고, 상세만 5탭을 숨기고 실행 CTA 하나를 둔다. */
export function r2ApprovalListConfig(): ShellScreenConfig {
  return { mode: 'BROWSE', title: '확인할 작업' }
}

export function r2ApprovalDetailConfig(onBack?: () => void): ShellScreenConfig {
  return { mode: 'REVIEW', title: '승인 확인', backHref: '/app/approvals', onBack }
}

/** 실행 경로가 아직 없어 CTA 는 항상 disabled 다. 시그니처상 필요한 핸들러. */
const locked = () => {}


export function R2ApprovalList({ workspaceId }: { workspaceId: string }) {
  const { view, loading, error, refresh } = useMobileHome(workspaceId)
  const decisions = view?.decisions
  const items = useMemo(() => decisions?.data?.items ?? [], [decisions?.data?.items])
  const empty = decisions ? confirmedEmpty(decisions) : false
  // 조회 실패·불명·오래된 값은 '확인할 일 없음'이 아니다(fail-closed).
  const incomplete = error || decisions?.state === 'error' || decisions?.state === 'unknown' || decisions?.state === 'stale'

  return (
    <>
      <ShellScreen {...r2ApprovalListConfig()} />
      <div className="mx-auto w-full max-w-2xl space-y-5 pb-6 text-foreground">
        <header className="space-y-1 pt-1">
          <h1 className="text-2xl font-semibold tracking-tight">확인할 작업</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">저장된 내용을 검토해요.</p>
        </header>

        {incomplete ? (
          <p role="status" className="rounded-xl border border-border p-4 text-sm leading-relaxed">
            작업 목록을 불러오지 못했어요.
          </p>
        ) : null}
        {!view && loading && !incomplete ? <p role="status" className="text-sm text-muted-foreground">작업 목록을 불러오고 있어요.</p> : null}

        {items.length ? (
          <ul className="space-y-3">
            {items.map(item => (
              <li key={item.id}>
                <Link
                  prefetch={false}
                  href={`/app/approvals?item=${encodeURIComponent(item.id)}`}
                  className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-base font-semibold leading-snug">{item.title}</span>
                      <StatusPill kind="review" label="내용 검토" compact className="shrink-0" />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{item.targetLabel}</p>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : empty ? (
          <StateView
            kind="confirmed_empty"
            title="지금 확인하실 일은 없어요"
            description="새 글을 소희에게 맡겨 보세요."
            action={
              <Button asChild className="min-h-12 w-full">
                <Link href="/app/work/new">소희에게 글 맡기기</Link>
              </Button>
            }
          />
        ) : null}

        <Button variant="outline" onClick={refresh} className="min-h-12 w-full gap-2">
          <RefreshCw className="size-4" aria-hidden="true" />다시 확인하기
        </Button>
      </div>
    </>
  )
}

interface DetailState {
  key: string
  view: MobileApprovalView | null
  v2: MobileApprovalViewV2 | null
  error: boolean
}

function isV2(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && (raw as { v?: unknown }).v === 2
}

export function R2ApprovalDetail({ workspaceId, item }: { workspaceId: string; item: string }) {
  const router = useRouter()
  const [reload, setReload] = useState(0)
  const [state, setState] = useState<DetailState>({ key: '', view: null, v2: null, error: false })
  const key = `${workspaceId}/${item}/${reload}`

  const handleBack = useCallback(() => {
    const previousRoute = consumeDecisionReturn(workspaceId, item)
    if (previousRoute) {
      if (typeof window !== 'undefined' && window.history.length > 1) router.back()
      else router.replace(previousRoute)
      return
    }
    try {
      const currentOrigin = typeof window !== 'undefined' && window.location
        ? window.location.origin
        : (typeof location !== 'undefined' ? location.origin : '')
      const previous = new URL(document.referrer)
      const value = previous.pathname + previous.search
      if (currentOrigin && previous.origin === currentOrigin && safeReturnPath(value) === value) {
        if (typeof window !== 'undefined' && window.history.length > 1) {
          router.back()
          return
        }
        router.replace('/app/approvals')
        return
      }
    } catch { /* Direct links have no trusted return entry. */ }
    router.replace('/app/approvals')
  }, [workspaceId, item, router])

  useEffect(() => {
    const controller = new AbortController()
    if (!approvalKey(item)) return () => controller.abort()
    void fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/mobile-approvals/${encodeURIComponent(item)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('조회 실패')
        const raw: unknown = await response.json()
        // 서버가 v2(게이트·지문 포함)를 내려주면 실행 판정에 쓰고, 표시는 v1 계약으로 맞춘다.
        const v2 = isV2(raw) ? mobileApprovalV2Schema.parse(raw) : null
        const view = v2 ? toMobileApprovalV1(v2) : mobileApprovalSchema.parse(raw)
        if (view.workspaceId !== workspaceId || view.id !== item) throw new Error('작업 확인 필요')
        if (!controller.signal.aborted) setState({ key, view, v2, error: false })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ key, view: null, v2: null, error: true })
      })
    return () => controller.abort()
  }, [workspaceId, item, key])

  const current = state.key === key ? state : null
  const view = current?.view ?? null
  // 조회 대상 키가 아니면 요청 자체를 보내지 않는다(임의 id 로 서버를 두드리지 않음).
  const invalidKey = !approvalKey(item)

  const config = useMemo<ShellScreenConfig>(() => {
    const cta = resolveApprovalCta(
      invalidKey
        ? { state: 'error' }
        : !current
          ? { state: 'loading' }
          : current.error
            ? { state: 'error' }
            : { state: 'ready', view: current.v2, fallbackReason: current.view?.reason ?? '내용을 확인한 뒤 실행할 수 있어요.' },
    )
    return {
      ...r2ApprovalDetailConfig(handleBack),
      ...(current?.view?.datasetMode === 'ACTUAL' && (current.view.kind === 'dm_reply' || current.view.kind === 'comment_reply' || current.view.kind === 'post_publish') ? {} : { cta: { label: cta.label, onPress: locked, disabled: cta.disabled, disabledReason: cta.reason, secondary: [{ label: '최신 내용 확인', onPress: () => setReload(value => value + 1) }] } }),
    }
  }, [current, invalidKey, handleBack])

  return (
    <>
      <ShellScreen {...config} />
      <div className="mx-auto w-full max-w-2xl space-y-6 pb-6 text-foreground">
        {!view ? (
          <section className="space-y-4 pt-1">
            <h2 className="text-2xl font-semibold tracking-tight">내용 검토</h2>
            <p role="status" className="text-base leading-relaxed text-muted-foreground">
              {invalidKey
                ? '이 작업을 확인할 수 없어요. 이전 주소이거나 이미 완료된 작업일 수 있어요.'
                : current?.error
                  ? '작업을 불러오지 못했어요. 다시 확인해 주세요.'
                  : '전체 내용을 확인하고 있어요.'}
            </p>
            {(invalidKey || current?.error) && (
              <Button asChild variant="outline" className="min-h-12 w-full">
                <Link href="/app/approvals">확인할 작업 목록으로 돌아가기</Link>
              </Button>
            )}
          </section>
        ) : (
          <>
            <header className="space-y-3 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="shrink-0 whitespace-nowrap rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">내용 검토</span>
                <span className="shrink-0 whitespace-nowrap rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
                  {view.datasetMode === 'TEST' || view.datasetMode === 'DEMO' ? '테스트 예시 · 실제 실행 없음' : view.datasetMode === 'ACTUAL' ? '내용 확인·최종 승인' : '업무 데이터 확인 필요'}
                </span>
              </div>
              <h2 className="break-words break-keep text-2xl font-semibold leading-snug tracking-tight">{view.title}</h2>
              <p className="text-base text-muted-foreground">{view.targetLabel || '대상 계정 확인 필요'}</p>
            </header>

            <section aria-label="고객 원문" className="space-y-2">
              <h2 className="text-lg font-semibold">어떤 요청인가요?</h2>
              <div className="whitespace-pre-wrap break-words rounded-2xl border border-border bg-card p-5 text-base leading-7">
                {view.sourceText || '원본 내용을 아직 확인하지 못했어요.'}
              </div>
            </section>

            {view.datasetMode === 'ACTUAL' && (view.kind === 'dm_reply' || view.kind === 'comment_reply') ? <ReplyApprovalActions key={`${workspaceId}:${item}`} workspaceId={workspaceId} item={item} /> : <>
            <section aria-label="전체 초안" className="space-y-2">
              <h2 className="text-lg font-semibold">소희가 준비한 내용</h2>
              <div className="whitespace-pre-wrap break-words rounded-2xl border border-primary/20 bg-card p-5 text-base leading-7">
                {view.fullContent || '전체 초안이 아직 준비되지 않았어요'}
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">내용 확인용 예상 화면이에요. 실제 게시·발송 화면과 다를 수 있어요.</p>
            </section>

            {view.datasetMode === 'ACTUAL' && view.kind === 'post_publish' ? <PostApprovalContinuation item={view.id} workspaceId={workspaceId} /> : <section aria-label="실행 전 확인" className="space-y-3 rounded-2xl bg-muted/50 p-5">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <ShieldCheck className="size-5 text-primary" aria-hidden="true" />실행 전에 확인해요
              </h2>
              <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
                <li>대상 계정·권한과 이 내용의 최종 버전을 다시 확인해야 해요.</li>
                <li>비용·사진 권리·예약 시간은 아직 확인되지 않았어요.</li>
                <li>이 화면을 닫아도 게시·답장·예약은 실행되지 않아요.</li>
              </ul>
            </section>}
            </>}
          </>
        )}
      </div>
    </>
  )
}
