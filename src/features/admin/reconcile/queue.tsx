'use client'

import { useState } from 'react'
import { EmptyNotice } from '@/components/admin-ui/data-state'
import { formatKst, referenceCode } from '@/components/admin-ui/labels'
import type { QueueItem } from './service'

type Props = { items: QueueItem[] }

export function ReconcileQueue({ items }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [decision, setDecision] = useState<'POST_PRESENT' | 'POST_ABSENT'>('POST_PRESENT')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function act(item: QueueItem, action: 'readback' | 'manual_confirm') {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/reconcile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          requestId: item.id,
          workspaceId: item.workspaceId,
          ...(action === 'manual_confirm' ? { reason, decision } : {}),
        }),
      })
      const result = await response.json()
      setMessage(
        response.ok
          ? action === 'manual_confirm'
            ? '판단과 사유를 감사 기록에 저장했습니다. 게시 확인 상태는 변경되지 않았습니다.'
            : result.state === 'FOUND'
              ? '외부 게시물 후보가 발견됐습니다. 증거 검토가 필요합니다.'
              : '게시 여부가 확정되지 않았습니다. 재게시하지 마세요.'
          : result.error ?? '조회가 실패했습니다.',
      )
    } catch {
      setMessage('조회가 실패했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  if (!items.length) {
    return (
      <EmptyNotice
        title="현재 대사할 게시 기록이 없어요"
        description="독립 확인이 필요한 불일치 건이 없거나 모든 게시가 이미 확인되었습니다."
      />
    )
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <article key={item.id} className="rounded-xl border bg-card p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{item.channelLabel} · {item.kindLabel}</span>
              <span className="text-xs text-muted-foreground">
                (참조번호 {referenceCode(item.id)})
              </span>
            </div>
            <time className="text-xs text-muted-foreground" dateTime={item.occurredAt}>
              {formatKst(item.occurredAt)}
            </time>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-lg border bg-background px-4 text-xs font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-purple-600"
              onClick={() => setSelected(selected === item.id ? null : item.id)}
              aria-expanded={selected === item.id}
              aria-controls={`evidence-${item.id}`}
            >
              {selected === item.id ? '증거 접기' : '증거 보기 및 대사 진행'}
            </button>
          </div>

          {selected === item.id && (
            <div id={`evidence-${item.id}`} className="space-y-4 rounded-lg bg-muted/30 p-4 text-sm break-words border">
              <div className="space-y-1.5 text-xs">
                <div className="p-2 rounded bg-background border"><span className="font-semibold text-foreground">요청 요약:</span> {item.requestSummary}</div>
                <div className="p-2 rounded bg-background border"><span className="font-semibold text-foreground">응답 요약:</span> {item.responseSummary}</div>
                <div className="p-2 rounded bg-background border"><span className="font-semibold text-foreground">영수증 요약:</span> {item.receiptSummary}</div>
                <div className="p-2 rounded bg-background border"><span className="font-semibold text-foreground">대사 조회 요약:</span> {item.readbackSummary}</div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy}
                  className="inline-flex min-h-11 items-center rounded-lg border border-purple-600/30 bg-purple-500/10 px-4 text-xs font-semibold text-purple-800 hover:bg-purple-500/20 disabled:opacity-50 dark:text-purple-200"
                  onClick={() => act(item, 'readback')}
                >
                  {busy ? '조회 중...' : '읽기 전용 재조회'}
                </button>
                <button
                  type="button"
                  disabled
                  title="독립 조회와 증거 대사로 게시 여부가 확정되기 전까지 재게시할 수 없습니다."
                  className="inline-flex min-h-11 items-center rounded-lg border bg-muted px-4 text-xs font-semibold text-muted-foreground opacity-60 cursor-not-allowed"
                >
                  임의 재게시 차단됨
                </button>
              </div>

              <div className="space-y-3 border-t pt-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`decision-${item.id}`} className="text-xs font-medium text-muted-foreground">
                    수동 판단
                  </label>
                  <select
                    id={`decision-${item.id}`}
                    value={decision}
                    onChange={(event) => setDecision(event.target.value as typeof decision)}
                    className="h-10 rounded-lg border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-purple-600"
                  >
                    <option value="POST_PRESENT">게시 확인 의견</option>
                    <option value="POST_ABSENT">게시 없음 의견</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`reason-${item.id}`} className="text-xs font-medium text-muted-foreground">
                    판단 사유 (필수 입력)
                  </label>
                  <textarea
                    id={`reason-${item.id}`}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={500}
                    placeholder="대사 근거와 외부 게시 확인 경위를 자세히 적어주세요."
                    className="rounded-lg border bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-purple-600"
                  />
                </div>

                <button
                  type="button"
                  disabled={busy || !reason.trim()}
                  className="inline-flex min-h-11 items-center rounded-lg bg-purple-700 px-5 text-xs font-semibold text-white shadow-xs hover:bg-purple-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-600"
                  onClick={() => act(item, 'manual_confirm')}
                >
                  사유와 판단 기록
                </button>
              </div>

              {message && (
                <div role="status" className="rounded-lg border bg-background p-3 text-xs font-medium text-foreground">
                  {message}
                </div>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  )
}
