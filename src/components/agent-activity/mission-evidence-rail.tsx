'use client'

import { useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { MissionEvidence } from '@/features/agent-activity/mission-evidence'

type Scope = { workspaceId: string; missionId: string; runId: string }

export function MissionEvidenceRail(props: Scope) {
  return <EvidencePanel key={`${props.workspaceId}:${props.missionId}:${props.runId}`} {...props} />
}

function EvidencePanel({ workspaceId, missionId, runId }: Scope) {
  const regionId = useId()
  const [expanded, setExpanded] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [evidence, setEvidence] = useState<MissionEvidence | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!expanded) return
    const controller = new AbortController()
    setEvidence(null)
    setError(false)
    async function load() {
      try {
        const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/agent/evidence?missionId=${encodeURIComponent(missionId)}&runId=${encodeURIComponent(runId)}`, { cache: 'no-store', signal: controller.signal })
        const data = await response.json()
        if (!response.ok || data.workspaceId !== workspaceId || data.missionId !== missionId || data.runId !== runId
          || !data.evidence || !Array.isArray(data.evidence.channels)
          || !['UNKNOWN', 'CONFIRMED'].includes(data.evidence.reservations?.state)
          || !['UNKNOWN', 'CONFIRMED'].includes(data.evidence.price?.state)) throw new Error('INVALID_EVIDENCE')
        if (!controller.signal.aborted) setEvidence(data.evidence)
      } catch {
        if (!controller.signal.aborted) setError(true)
      }
    }
    void load()
    return () => controller.abort()
  }, [expanded, attempt, workspaceId, missionId, runId])

  return <aside aria-label="미션 판단 근거" className="min-w-0 rounded-xl border border-border bg-muted/30 p-3 text-xs text-foreground">
    <Button variant="ghost" className="min-h-11 w-full justify-between" aria-expanded={expanded} aria-controls={regionId} onClick={() => setExpanded(value => !value)}>
      {expanded ? '판단 근거 접기' : '판단 근거 펼치기'}
    </Button>
    {expanded && <div id={regionId} className="space-y-3 break-words pt-2">
      {!evidence && !error && <p role="status">근거를 확인하고 있습니다.</p>}
      {error && <><p role="alert">근거를 불러오지 못했습니다. 확인된 결과로 표시하지 않습니다.</p><Button variant="outline" className="min-h-11" onClick={() => setAttempt(value => value + 1)}>근거 다시 확인</Button></>}
      {evidence && <>
        <section aria-label="예약장부 조회 근거"><h4 className="font-semibold">예약장부</h4>
          {evidence.reservations.state === 'CONFIRMED' ? <><p>조회 결과 {evidence.reservations.count}건</p><p className="text-muted-foreground">조회 시각 · <time dateTime={evidence.reservations.observedAt}>{new Date(evidence.reservations.observedAt).toLocaleString('ko-KR')}</time></p><p className="text-muted-foreground">이 작업의 조회 결과이며, 예약 목표 달성 건수가 아닙니다.</p></> : <p>실제 조회 근거 확인 필요</p>}
        </section>
        <section aria-label="SNS 권한 근거"><h4 className="font-semibold">SNS 연결과 게시 권한</h4>
          {evidence.channels.length === 0 && <p>연결과 권한 확인 필요</p>}
          {evidence.channels.map(channel => <p key={channel.provider}>{channel.provider === 'instagram' ? '인스타그램' : '스레드'} · {channel.connection === 'NOT_CONNECTED' ? '연결 필요' : channel.connection !== 'CONNECTED' ? '연결 확인 필요' : channel.permission === 'GRANTED' ? '게시 권한 확인' : '게시 권한 확인 필요'}</p>)}
        </section>
        <section aria-label="가격 정책 근거"><h4 className="font-semibold">가격 정책</h4>
          <p>{evidence.price.state === 'CONFIRMED' ? `첫 게시 정책 · 게시 비용 ${evidence.price.amountKrw.toLocaleString('ko-KR')}원` : '적용 정책 확인 필요'}</p>
          <p className="text-muted-foreground">계획의 예상 크레딧과 게시 비용은 별도입니다.</p>
        </section>
      </>}
    </div>}
  </aside>
}
