'use client'

import { ArrowLeft, MessageSquareText, ShieldCheck } from 'lucide-react'
import { AppLink as Link } from '@/components/navigation/app-link'
import { useState, type FormEvent } from 'react'
import type { ReportInsight } from './types'
import styles from './report-dashboard.module.css'

type StartAction = typeof import('./actions/report-decision').startReportConversationAction
type Result = Awaited<ReturnType<StartAction>>

async function defaultSubmitAction(value: unknown): Promise<Result> {
  const { startReportConversationAction } = await import('./actions/report-decision')
  return startReportConversationAction(value)
}

export function ReportPlanBuilder({
  workspaceId,
  insight,
  periodStart,
  periodEnd,
  submitAction = defaultSubmitAction,
  navigate = (path) => globalThis.location.assign(path),
}: Readonly<{
  workspaceId: string
  insight: ReportInsight
  periodStart: string
  periodEnd: string
  submitAction?: (value: unknown) => Promise<Result>
  navigate?: (path: string) => void
}>) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const invariants = form.getAll('invariants').map(String).filter(Boolean)
    const result = await submitAction({
      workspaceId,
      insightKey: insight.id,
      periodStart,
      periodEnd,
      observedFacts: insight.observedFacts,
      hypothesis: String(form.get('hypothesis') ?? ''),
      changeVariable: String(form.get('changeVariable') ?? ''),
      invariants,
      customerSignalIds: [],
      ownerNote: String(form.get('ownerNote') ?? '') || null,
      evidenceVersionIds: insight.evidence.map((item) => item.contentVersionId),
    })
    if (result.ok) {
      navigate(result.next)
      return
    }
    setError(result.code === 'REPORT_DECISION_FORBIDDEN'
      ? '이 작업은 작업공간 소유자와 관리자만 저장할 수 있어요.'
      : '판단을 저장하지 못했어요. 입력값과 연결 상태를 확인해 주세요.')
    setPending(false)
  }

  return (
    <section aria-labelledby="report-plan-title" className={styles.planBuilder}>
      <header>
        <Link href={`/app/reports?from=${periodStart.slice(0, 10)}&to=${periodEnd.slice(0, 10)}&insight=${encodeURIComponent(insight.id)}`}>
          <ArrowLeft aria-hidden="true" /> 근거로 돌아가기
        </Link>
        <p>리포트에서 대화로 이어가기</p>
        <h1 id="report-plan-title">다음 포스팅 방향 정하기</h1>
        <span>{insight.title}</span>
      </header>

      <div className={styles.planWorkspace}>
      <form onSubmit={submit}>
        <fieldset className={styles.planEvidenceGallery}>
          <legend><span>1</span>가져갈 근거</legend>
          <p>이번 주 반응을 만든 정확한 게시 버전을 가져갑니다.</p>
          <div>{insight.evidence.slice(0, 3).map((item) => <article key={item.contentVersionId}><strong>{item.title}</strong><span>게시 버전 v{item.versionNumber}</span><small>{item.channel}</small></article>)}</div>
        </fieldset>
        <fieldset>
          <legend><span>2</span>확인된 사실</legend>
          <ul>{insight.observedFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
        </fieldset>

        <label>
          <span><b>3</b>검증할 가설</span>
          <textarea aria-label="검증할 가설" defaultValue={insight.interpretations[0]} maxLength={1000} name="hypothesis" required rows={4} />
          <small>사실로 단정하지 않고, 다음 게시에서 확인할 설명을 적어요.</small>
        </label>

        <label>
          <span><b>4</b>이번에 바꿀 한 가지</span>
          <select aria-label="이번에 바꿀 한 가지" defaultValue="opening" name="changeVariable" required>
            <option value="opening">첫 문장</option>
            <option value="format">콘텐츠 형식</option>
            <option value="cta">행동 제안</option>
            <option value="timing">게시 시각</option>
            <option value="other">그 밖의 한 가지</option>
          </select>
        </label>

        <fieldset>
          <legend><span>5</span>그대로 유지할 조건</legend>
          <label><input defaultChecked name="invariants" type="checkbox" value="본문 구조" />본문 구조</label>
          <label><input defaultChecked name="invariants" type="checkbox" value="게시 채널" />게시 채널</label>
          <label><input defaultChecked name="invariants" type="checkbox" value="게시 시각대" />게시 시각대</label>
        </fieldset>

        <label>
          <span>내 메모 <small>선택</small></span>
          <textarea maxLength={1000} name="ownerNote" placeholder="이번 판단에서 꼭 기억할 내용을 적어 주세요." rows={3} />
        </label>

        <aside>
          <ShieldCheck aria-hidden="true" />
          <div>
            <strong>저장만으로 게시하거나 메시지를 보내지 않아요.</strong>
            <span>대화 화면에서 맥락을 다시 확인하고, 첫 메시지를 직접 보내야 작업이 시작돼요.</span>
          </div>
        </aside>
        {error ? <p aria-live="polite" className={styles.planError}>{error}</p> : null}
        <button disabled={pending} type="submit">
          <MessageSquareText aria-hidden="true" />
          {pending ? '판단을 저장하는 중…' : '대화에서 개선 시작하기'}
        </button>
      </form>
      <aside className={styles.planPreview}>
        <header><p>새 대화 미리보기</p><h2>이 근거를 바탕으로 소희와 나눌 대화예요.</h2></header>
        <div className={styles.soheePreviewMessage}><span aria-hidden="true">S.</span><p>최근 반응 근거를 가져왔어요. 같은 주제에서 질문형 첫 문장과 정보형 첫 문장을 비교해볼까요?</p></div>
        <section><h3>제안할 다음 포스팅 방향</h3><button type="button"><strong>가 · 질문형</strong><span>독자의 고민을 질문으로 먼저 꺼내기</span></button><button type="button"><strong>나 · 정보형</strong><span>핵심 정보를 첫 문장에서 바로 전달하기</span></button></section>
        <p><ShieldCheck aria-hidden="true" />대화를 시작해도 게시나 일정은 자동 실행되지 않아요.</p>
      </aside>
      </div>
    </section>
  )
}
