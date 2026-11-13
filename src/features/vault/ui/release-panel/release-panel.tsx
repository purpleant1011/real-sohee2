'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import type { ReleaseRow } from './release-service'
import type { BatchPublishItemResult, BatchPublishResult } from '../../publish/batch-publish'
import { ReadinessCard } from '@/features/publish-readiness/readiness-card'
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard'

type Connection = { channel: string; label: string; open: boolean; reason_label: string | null; review_label: string }
type Status = { open: boolean; reason_label: string | null; count: number; connections: Connection[] }
type Report = { passed: number; needs_review: number; items: ReleaseRow[] }
async function get<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init })
  const payload = await response.json()
  if (!response.ok || !payload.success) throw new Error(typeof payload.error === 'string' ? payload.error : '상태를 확인하지 못했어요. 다시 시도해 주세요')
  return payload.data
}
export function ReleasePanel({ workspaceId }: { workspaceId: string }) {
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}/vault/release`
  const [status, setStatus] = useState<Status | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ReleaseRow | null>(null)
  const [outcomes, setOutcomes] = useState<BatchPublishItemResult[]>([])
  const runExternalWrite = useExternalWriteGuard()
  useEffect(() => {
    const controller = new AbortController()
    get<Status>(base, { signal: controller.signal }).then(setStatus).catch(() => { if (!controller.signal.aborted) setError('연결 상태를 가져오지 못했어요. 다시 시도해 주세요') })
    return () => controller.abort()
  }, [base])
  async function preflight() {
    setBusy(true); setError(null); setNotice(null)
    try {
      const result = await get<Report>(`${base}/preflight`, { method: 'POST' })
      setReport(result)
      setSelected(result.items.filter(row => row.can_release).map(row => row.item_ref))
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  async function request() {
    setBusy(true); setError(null)
    try {
      const result = await get<{ requested: number; items: ReleaseRow[] }>(`${base}/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemIds: selected }) })
      setNotice(`${result.requested}건의 발행 요청을 저장했어요. 실제 게시는 아직 시작되지 않았어요`)
      setReport({ passed: result.items.filter(row => row.can_release).length, needs_review: result.items.filter(row => !row.can_release).length, items: result.items })
      setSelected([])
      setStatus(await get<Status>(base))
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  async function publish(row: ReleaseRow) {
    setConfirm(null); setBusy(true); setError(null)
    try {
      // 실제 게시는 오프라인이거나 같은 글이 이미 진행 중이면 시작하지 않는다(ANI-1778).
      const outcome = await runExternalWrite('publish', `vault:${row.item_ref}`, async () => {
        const data = await get<BatchPublishResult>(`/api/workspaces/${encodeURIComponent(workspaceId)}/vault/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemRefs: [row.item_ref] }) })
        setOutcomes(current => [...current.filter(entry => entry.item_ref !== row.item_ref), ...data.results])
        setStatus(await get<Status>(base))
      })
      if (!outcome.ran) setError(outcome.decision.message)
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  return <section aria-label="연결 확인 후 한 번에 발행" className="min-w-0 space-y-4">
    <ReadinessCard workspaceId={workspaceId} />
    <Card className="gap-4 border-border py-5 shadow-xs">
      <CardHeader className="space-y-1 px-5">
        <h2 className="text-lg font-bold">연결 확인 후 한 번에 발행</h2>
        <p className="text-sm text-muted-foreground">채널 연결 상태를 확인하고 준비된 글만 안전하게 발행해요. 인스타그램과 스레드는 발행하기를 누르면 실제 게시돼요.</p>
      </CardHeader>
      <CardContent className="space-y-4 px-5">
        {!status && !error && <p role="status">연결 상태를 확인하는 중이에요</p>}
        {status && <>
          <div className="overflow-x-auto"><table className="w-full min-w-60 text-left text-sm"><caption className="sr-only">채널 연결 상태</caption><thead><tr><th scope="col" className="pb-2">채널</th><th scope="col" className="pb-2">연결 상태</th><th scope="col" className="pb-2">발행 준비</th></tr></thead><tbody>{status.connections.map(connection => <tr key={connection.channel} className="border-t border-border"><th scope="row" className="py-2 font-medium">{connection.label}</th><td className="py-2">{connection.review_label}</td><td className="py-2">{connection.open ? '연결 완료' : connection.reason_label ?? '확인 필요'}</td></tr>)}</tbody></table></div>
          <p className="text-sm">보관한 글 {status.count}건 · {report ? `승인 그대로인 글 ${report.passed}건 · 다시 확인해야 하는 글 ${report.needs_review}건` : '재검사하면 통과 건수와 재확인 건수를 알려드려요'}</p>
          {!status.open && <p className="rounded-md border border-state-warn/40 bg-state-warn-soft p-3 text-sm text-state-warn ">지금은 열 수 없어요 · {status.reason_label}</p>}
          <Button type="button" disabled={!status.open || busy} onClick={preflight}>발행 확인 시작</Button>
        </>}
        {report && <div className="space-y-4" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">재검사 결과</h3><Button type="button" variant="outline" size="sm" disabled={busy || report.passed === 0} onClick={() => setSelected(selected.length === report.passed ? [] : report.items.filter(row => row.can_release).map(row => row.item_ref))}>{selected.length === report.passed ? '전체 선택 해제' : '통과한 글 전체 선택'}</Button></div>
          <ul className="space-y-3">{report.items.map((row, index) => <li key={row.item_ref} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex items-center gap-2">{row.can_release && <input type="checkbox" className="size-5 accent-primary" aria-label={`${row.channel_label} ${index + 1}번째 글 통과 선택`} checked={selected.includes(row.item_ref)} onChange={() => setSelected(current => current.includes(row.item_ref) ? current.filter(id => id !== row.item_ref) : [...current, row.item_ref])} />}<span className="font-semibold">{row.channel_label} {index + 1}번째 글 · {row.status_label}</span></div>
            {row.reason_label && <p className="mt-2">{row.reason_label}</p>}{row.action_label && <p className="mt-1 font-medium">해결 방법 · {row.action_label}</p>}
            <ul className="mt-2 space-y-1 text-muted-foreground">{row.checks.map((check, i) => <li key={i}>{check.status_label} · {check.message}</li>)}</ul>
            {(row.channel === 'naver_blog' || row.channel === 'daangn_business') && <p className="mt-2">소희에서 미리보기까지만 지원해요 · 복사해서 직접 게시해 주세요</p>}
            {(row.channel === 'instagram' || row.channel === 'threads') && (
              row.can_release ? (
                !selected.includes(row.item_ref) && !outcomes.some(entry => entry.item_ref === row.item_ref) && (
                  <Button type="button" className="mt-2 min-h-11" disabled={busy} onClick={() => setConfirm(row)}>발행하기</Button>
                )
              ) : (
                !outcomes.some(entry => entry.item_ref === row.item_ref) && (
                  <div className="mt-2 flex flex-col items-start gap-1">
                    <Button type="button" className="min-h-11" disabled aria-disabled="true">발행하기</Button>
                    <p className="text-xs text-destructive">{row.reason_label ?? '채널 연결 상태를 확인해 주세요'}</p>
                  </div>
                )
              )
            )}
            {outcomes.find(entry => entry.item_ref === row.item_ref) && <p role="status" className="mt-2 font-medium">{outcomes.find(entry => entry.item_ref === row.item_ref)?.message}</p>}
          </li>)}</ul>
          <p className="text-sm text-muted-foreground">발행 요청은 게시가 아니에요. 실제 게시는 발행하기로 따로 확인해 주세요.</p>
          <Button type="button" disabled={busy || selected.length === 0} onClick={request}>선택한 글 {selected.length}건 발행 요청</Button>
        </div>}
        {confirm && (() => {
          const accountText = confirm.account_label.endsWith('계정') ? confirm.account_label : `${confirm.account_label} 계정`
          return (
            <div role="alertdialog" aria-modal="true" aria-labelledby="publish-confirm-title" aria-describedby="publish-confirm-description" onKeyDown={event => { if (event.key === 'Escape') setConfirm(null) }} className="rounded-lg border border-border bg-background p-4 shadow-lg">
              <h3 id="publish-confirm-title" className="font-semibold">{confirm.channel_label}에 게시할까요?</h3>
              <p id="publish-confirm-description" className="my-3 text-sm">{confirm.channel_label} · {accountText}에 실제로 게시돼요. 게시한 뒤에는 되돌릴 수 없어요.</p>
              <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" autoFocus onClick={() => setConfirm(null)}>취소</Button><Button type="button" className="min-h-11" disabled={busy || !confirm.can_release} onClick={() => publish(confirm)}>실제 발행하기</Button></div>
            </div>
          )
        })()}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="text-sm font-medium">{notice}</p>}
      </CardContent>
    </Card>
  </section>
}
