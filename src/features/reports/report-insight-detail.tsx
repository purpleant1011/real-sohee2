import { AppLink as Link } from '@/components/navigation/app-link'
import { ArrowLeft, CheckCircle2, CircleHelp, Eye, Sparkles } from 'lucide-react'
import type { ReportInsight } from './types'
import type { ReportTrendPoint } from './types'
import { ReportTrendChart } from './report-trend-chart'
import { PostEmbed } from '@/features/social-embed/post-embed'
import styles from './report-dashboard.module.css'

const confidenceLabels = {
  limited: '제한',
  moderate: '보통',
  strong: '높음',
} as const

export function ReportInsightDetail({ insight, periodQuery = '', trend = [] }: Readonly<{ insight: ReportInsight; periodQuery?: string; trend?: readonly ReportTrendPoint[] }>) {
  const briefingHref = `/app/reports${periodQuery ? `?${periodQuery}` : ''}`
  const planHref = `/app/reports?${periodQuery ? `${periodQuery}&` : ''}insight=${encodeURIComponent(insight.id)}&action=plan`

  return (
    <div className={styles.insightDetailPage}>
      <nav aria-label="현재 위치" className={styles.reportBreadcrumb}><Link href={briefingHref}>리포트</Link><span>/</span><Link href={briefingHref}>이번 주 브리핑</Link><span>/</span><strong>인사이트 상세</strong></nav>
      <Link className={styles.mobileBackLink} href={briefingHref}><ArrowLeft aria-hidden="true" />인사이트 상세</Link>
      <header className={styles.insightDetailHeader}>
        <p>인사이트 근거 상세</p>
        <h1 id="report-title">{insight.title}</h1>
        <span>핵심 변화의 근거와 소희의 해석을 나누어 확인해 보세요.</span>
      </header>

      <div className={styles.insightDetailGrid}>
        <section aria-labelledby="comparison-trend-title" className={styles.insightChartPanel}>
          <header><h2 id="comparison-trend-title">7일 비교 추이</h2><span>계산 기준 보기</span></header>
          <ReportTrendChart points={trend} />
          <p><Sparkles aria-hidden="true" />정확한 게시 버전이 연결된 날짜만 차트에 표시해요.</p>
        </section>
        <aside className={styles.interpretationLedger}>
          <header><Sparkles aria-hidden="true" /><strong>소희의 해석</strong></header>
          <section>
            <div><Eye aria-hidden="true" /><h2>관찰된 사실</h2></div>
            <ul>{insight.observedFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
          </section>
          <section>
            <div><Sparkles aria-hidden="true" /><h2>가능한 해석</h2></div>
            <ul>{insight.interpretations.map((interpretation) => <li key={interpretation}>{interpretation}</li>)}</ul>
          </section>
          <section>
            <div><CircleHelp aria-hidden="true" /><h2>아직 모르는 것</h2></div>
            <ul>{insight.unknowns.map((unknown) => <li key={unknown}>{unknown}</li>)}</ul>
          </section>
        </aside>
      </div>

      <div className={styles.insightDecisionRow}>
        <aside className={styles.insightDecisionPanel}>
          <span>근거 충분도: {confidenceLabels[insight.confidence]}</span>
          <p>관찰 사실과 해석을 분리했어요. 원인을 단정하지 않고 다음 비교에서 확인합니다.</p>
          <Link className={styles.primaryAction} href={planHref}><Sparkles aria-hidden="true" />이 근거로 새 글 만들기</Link>
          <Link className={styles.secondaryAction} href={briefingHref}>브리핑으로 돌아가기</Link>
        </aside>
      </div>

      <section aria-labelledby="insight-evidence-title" className={styles.insightEvidence}>
        <header>
          <h2 id="insight-evidence-title">근거 게시물 {insight.evidence.length}건</h2>
          <span>정확한 게시 버전 기준</span>
        </header>
        <ul>
          {insight.evidence.map((evidence) => (
            <li key={evidence.publishAttemptId}>
              <CheckCircle2 aria-hidden="true" />
              <div><strong>{evidence.title}</strong><span>{evidence.channel} · 게시 버전 v{evidence.versionNumber}</span></div>
              <code>{evidence.contentVersionId}</code>
              <span data-state={evidence.collectionState}>{evidence.collectionState === 'available' ? '수집 완료' : '상태 확인 필요'}</span>
              <PostEmbed permalink={evidence.permalink} title={`${evidence.title} 게시물`} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
