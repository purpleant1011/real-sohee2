import { AppLink as Link } from '@/components/navigation/app-link'
import { ArrowLeft, ArrowRight, CalendarPlus2, MessageSquareText, Sparkles } from 'lucide-react'
import type { CustomerSignal } from './types'
import styles from './report-dashboard.module.css'

const priorityLabels = {
  reply_required: '답변 필요',
  booking_likely: '예약 가능성 높음',
  content_evidence: '다음 콘텐츠 근거',
  observe: '관심 신호',
} as const

const channelLabels = {
  instagram: '인스타그램',
  threads: '스레드',
  naver_blog: '네이버 블로그',
  naver_place: '네이버 플레이스',
} as const

export function ReportSignalRadar({ signals, periodQuery = '' }: Readonly<{ signals: readonly CustomerSignal[]; periodQuery?: string }>) {
  const primarySignal = signals[0] ?? null
  const conversationHref = primarySignal === null ? '/app' : `/app?reportSignal=${encodeURIComponent(primarySignal.id)}`
  const base = periodQuery ? `${periodQuery}&` : ''

  return (
    <div className={styles.analysisPage}>
      <Link className={styles.backLink} href={`/app/reports${periodQuery ? `?${periodQuery}` : ''}`}><ArrowLeft aria-hidden="true" />브리핑으로 돌아가기</Link>
      <header className={styles.analysisHeader}>
        <div><p>리포트</p><h1 id="report-title">고객 여정 레이더</h1><span>반응이 생긴 순간부터 예약까지, 놓치지 않아요.</span></div>
      </header>

      <ol aria-label="고객 여정" className={styles.journeyRail}>
        <li><span>게시 노출</span><strong>연결 자료 없음</strong></li>
        <li><span>관심 반응</span><strong>{signals.length}</strong></li>
        <li><span>프로필 방문</span><strong>연결 자료 없음</strong></li>
        <li data-drop="true"><span>상담 문의</span><strong>{signals.filter((signal) => signal.priority !== 'observe').length}</strong><em>방문 자료가 연결되면 전환 구간을 비교할 수 있어요.</em></li>
        <li><span>예약</span><strong>{signals.filter((signal) => signal.priority === 'booking_likely').length}</strong></li>
        <li><span>확인된 매출</span><strong>연결 자료 없음</strong></li>
      </ol>

      <div className={styles.analysisGrid}>
        <section aria-labelledby="customer-signal-title" className={styles.signalListPanel}>
          <header><h2 id="customer-signal-title">지금 살펴볼 고객 신호</h2><span>개인정보를 줄인 요약</span></header>
          {signals.length === 0 ? <p className={styles.analysisEmpty}>지금 확인할 고객 신호가 없어요.</p> : (
            <ul>
              {signals.map((signal) => (
                <li key={signal.id}>
                  <span className={styles.channelMark}>{channelLabels[signal.channel].slice(0, 1)}</span>
                  <div><strong>“{signal.summary}”</strong><span>{signal.intent ?? '의도 확인 전'} · {channelLabels[signal.channel]}</span></div>
                  <em data-priority={signal.priority}>{priorityLabels[signal.priority]}</em>
                  {signal.relatedContentItemId ? <Link aria-label="관련 콘텐츠 근거 보기" href={`/app/reports?${base}work=${signal.relatedContentItemId}`}><ArrowRight aria-hidden="true" /></Link> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className={styles.patternPanel}>
          <p><Sparkles aria-hidden="true" />소희의 다음 제안</p>
          <h2>반복된 질문을 상담 답변과 다음 콘텐츠에 함께 반영해보세요.</h2>
          <span>{primarySignal?.summary ?? '새 고객 신호가 생기면 근거와 함께 제안할게요.'}</span>
          <Link className={styles.primaryAction} href={conversationHref}><MessageSquareText aria-hidden="true" />대화에서 답변 만들기</Link>
          <Link className={styles.secondaryAction} href={`/app/reports?${base}action=experiment`}><CalendarPlus2 aria-hidden="true" />후속 콘텐츠 일정 잡기</Link>
          <small>대화를 열어도 답변을 자동 전송하지 않아요.</small>
        </aside>
      </div>
    </div>
  )
}
