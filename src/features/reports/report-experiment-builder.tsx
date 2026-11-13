'use client'

import { CalendarRange, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { ReportInsight } from './types'
import styles from './report-dashboard.module.css'

type ExperimentAction = typeof import('./actions/report-decision').createReportExperimentAction
type DecisionAction = typeof import('./actions/report-decision').startReportConversationAction
type ExperimentResult = Awaited<ReturnType<ExperimentAction>>
type DecisionResult = Awaited<ReturnType<DecisionAction>>

async function defaultExperimentAction(value: unknown): Promise<ExperimentResult> {
  const { createReportExperimentAction } = await import('./actions/report-decision')
  return createReportExperimentAction(value)
}

async function defaultDecisionAction(value: unknown): Promise<DecisionResult> {
  const { startReportConversationAction } = await import('./actions/report-decision')
  return startReportConversationAction(value)
}

function iso(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || value.length === 0) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

export function ReportExperimentBuilder({
  workspaceId,
  decisionId = null,
  insight,
  periodStart = '2026-01-01T00:00:00.000Z',
  periodEnd = '2026-01-07T23:59:59.999Z',
  submitAction = defaultExperimentAction,
  submitDecisionAction = defaultDecisionAction,
  navigate = (path) => globalThis.location.assign(path),
}: Readonly<{
  workspaceId: string
  decisionId?: string | null
  insight: ReportInsight
  periodStart?: string
  periodEnd?: string
  submitAction?: (value: unknown) => Promise<ExperimentResult>
  submitDecisionAction?: (value: unknown) => Promise<DecisionResult>
  navigate?: (path: string) => void
}>) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const candidates = insight.evidence.slice(0, 8)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError('')
    const form = new FormData(event.currentTarget)
    let persistedDecisionId = decisionId
    if (!persistedDecisionId) {
      const decision = await submitDecisionAction({
        workspaceId,
        insightKey: insight.id,
        periodStart,
        periodEnd,
        observedFacts: insight.observedFacts,
        hypothesis: String(form.get('hypothesis') ?? ''),
        changeVariable: String(form.get('changeVariable') ?? ''),
        invariants: ['본문 구조', '게시 채널'],
        customerSignalIds: [],
        evidenceVersionIds: candidates.map((item) => item.contentVersionId),
      })
      if (!decision.ok) {
        setError('실험의 근거 판단을 저장하지 못했어요.')
        setPending(false)
        return
      }
      persistedDecisionId = decision.decisionId
    }
    const result = await submitAction({
      workspaceId,
      decisionId: persistedDecisionId,
      hypothesis: String(form.get('hypothesis') ?? ''),
      changeVariable: String(form.get('changeVariable') ?? ''),
      invariantKeys: ['본문 구조', '게시 채널'],
      variantAContentVersionId: String(form.get('variantAContentVersionId') ?? ''),
      variantBContentVersionId: String(form.get('variantBContentVersionId') ?? ''),
      variantAScheduledAt: iso(form.get('variantAScheduledAt')),
      variantBScheduledAt: iso(form.get('variantBScheduledAt')),
      primaryMetric: String(form.get('primaryMetric') ?? ''),
      secondaryMetrics: ['inquiries'],
      guardrailMetrics: ['negative_reactions'],
      reviewAt: iso(form.get('reviewAt')),
    })
    if (result.ok) {
      navigate(result.next)
      return
    }
    setError('실험 계획을 저장하지 못했어요. 버전과 시각을 다시 확인해 주세요.')
    setPending(false)
  }

  if (candidates.length < 2) {
    return (
      <section className={styles.planBuilder}>
        <header><p>정확한 버전 근거 필요</p><h1>비교할 게시 버전이 하나 더 필요해요</h1></header>
        <p className={styles.planError}>서로 다른 두 버전이 확인된 뒤에 실험 계획을 만들 수 있어요.</p>
      </section>
    )
  }

  return (
    <section aria-labelledby="report-experiment-title" className={styles.planBuilder}>
      <header>
        <p>리포트에서 일정으로 이어가기</p>
        <h1 id="report-experiment-title">한 번에 한 가지를 바꿔 비교해볼게요</h1>
        <span>아래 일정은 콘텐츠 실험 계획이며, 자동으로 게시되지는 않아요.</span>
      </header>
      <ol aria-label="실험 일정 단계" className={styles.experimentSteps}><li aria-current="step"><b>1</b>비교할 버전</li><li><b>2</b>일정</li><li><b>3</b>성과 기준</li><li><b>4</b>승인</li></ol>
      <form onSubmit={submit}>
        <label><span>검증할 가설</span><textarea aria-label="검증할 가설" defaultValue={insight.interpretations[0]} maxLength={1000} name="hypothesis" required rows={3} /></label>
        <label><span>이번에 바꿀 한 가지</span><select defaultValue="opening" name="changeVariable" required><option value="opening">첫 문장</option><option value="format">형식</option><option value="cta">행동 제안</option><option value="timing">게시 시각</option></select></label>
        <div className={styles.experimentGrid}>
          <label><span>가 버전</span><select aria-label="가 버전" defaultValue={candidates[0].contentVersionId} name="variantAContentVersionId" required>{candidates.map((item) => <option key={item.contentVersionId} value={item.contentVersionId}>{item.title} · v{item.versionNumber}</option>)}</select></label>
          <label><span>나 버전</span><select aria-label="나 버전" defaultValue={candidates[1].contentVersionId} name="variantBContentVersionId" required>{candidates.map((item) => <option key={item.contentVersionId} value={item.contentVersionId}>{item.title} · v{item.versionNumber}</option>)}</select></label>
          <label><span>가 게시 후보 시각</span><input aria-label="가 게시 후보 시각" name="variantAScheduledAt" required type="datetime-local" /></label>
          <label><span>나 게시 후보 시각</span><input aria-label="나 게시 후보 시각" name="variantBScheduledAt" required type="datetime-local" /></label>
        </div>
        <label><span>가장 먼저 볼 지표</span><select defaultValue="saved" name="primaryMetric" required><option value="saved">저장 반응</option><option value="visits">프로필 방문</option><option value="inquiries">문의</option></select></label>
        <label><span>결과 검토 시각</span><input aria-label="결과 검토 시각" name="reviewAt" required type="datetime-local" /></label>
        <section className={styles.approvalBoundary}><div><strong>승인 상태</strong><em>아직 승인 전</em></div><p><ShieldCheck aria-hidden="true" />일정 생성 후에도 게시 전 정확한 버전 승인이 필요해요.</p></section>
        <aside><ShieldCheck aria-hidden="true" /><div><strong>계획 저장만으로 승인·예약·게시되지 않아요.</strong><span>일정 화면에서 두 정확한 버전을 다시 검토하고 각각 승인해야 해요.</span></div></aside>
        {error ? <p aria-live="polite" className={styles.planError}>{error}</p> : null}
        <button disabled={pending} type="submit"><CalendarRange aria-hidden="true" />{pending ? '실험 계획 저장 중…' : '실험 계획을 일정에서 검토하기'}</button>
      </form>
    </section>
  )
}
