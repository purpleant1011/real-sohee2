'use client'

import { useCallback, useState } from 'react'

type Proposal = { kind: string; why: string; uncertainty: string; nextAction: string; paid: boolean; expectedCostKrw: number; audienceCount: number | null }
type Suppressed = { kind: string; reason: string; ownerMessage: string }
type View = { status: string; ownerPrompt: string; proposals: Proposal[]; suppressed: Suppressed[]; revisitAudience: { recipientRefs: string[] } }

const LABEL: Record<string, string> = {
  WORK_PHOTO_SHOWCASE: '작업 사진 보여주기', SERVICE_INTRO: '서비스 소개', OWNER_REVIEWED_FOLLOWUP: '사장님 확인 후 안내',
  BOUNDED_OFFER: '제한된 할인 제안', CTA_OR_POST_IMPROVEMENT: '문의 링크·게시물 다듬기',
}

/** Owner-facing review card. It only asks for confirmation; nothing is published or sent from here. */
export function ProposalReviewCard({ workspaceId, body }: { workspaceId: string; body: unknown }) {
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/sales-proposals`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(typeof data?.error === 'string' ? data.error : '제안을 불러오지 못했어요.'); return }
      setView(data as View)
    } catch { setError('제안을 불러오지 못했어요. 다시 확인해 주세요.') }
  }, [workspaceId, body])

  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>
  if (!view) return <button type="button" onClick={load} className="rounded-md border px-3 py-2 text-sm">제안 확인하기</button>
  return (
    <section aria-label="소희 제안" className="space-y-3">
      <p className="text-sm text-neutral-700">{view.ownerPrompt}</p>
      {view.proposals.length === 0 && <p className="text-sm text-neutral-600">지금은 확인된 근거로 만든 제안이 없어요.</p>}
      <ul className="space-y-2">
        {view.proposals.map(p => (
          <li key={p.kind} className="rounded-lg border p-3">
            <p className="text-sm font-medium">{LABEL[p.kind] ?? '제안'}{p.paid ? ` · 예상 비용 ${p.expectedCostKrw.toLocaleString('ko-KR')}원` : ' · 비용 없음'}</p>
            <p className="text-sm text-neutral-700">{p.why}</p>
            <p className="text-xs text-neutral-500">확실하지 않은 점: {p.uncertainty}</p>
            <p className="text-xs text-neutral-500">다음 할 일: {p.nextAction}</p>
            {p.audienceCount !== null && <p className="text-xs text-neutral-500">안내 가능한 고객 {p.audienceCount}명 (동의 확인된 고객만)</p>}
          </li>
        ))}
      </ul>
      {view.suppressed.length > 0 && (
        <ul className="space-y-1">
          {view.suppressed.map(s => <li key={s.kind} className="text-xs text-neutral-500">{s.ownerMessage}</li>)}
        </ul>
      )}
      <p className="text-xs text-neutral-500">모든 제안은 사장님이 확인하기 전에는 게시하거나 보내지 않아요.</p>
    </section>
  )
}
