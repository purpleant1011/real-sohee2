import { AppLink as Link } from '@/components/navigation/app-link'
import { ArrowRight, ChartNoAxesCombined, MessageSquareText, Sparkles } from 'lucide-react'
import type { M01ProactiveReport } from './proactive-report'
import { SoheeAvatar } from '@/components/brand/sohee-avatar'
import styles from './conversation-shell.module.css'

function formatMetric(value: number | null): string {
  return value === null ? '확인 대기' : new Intl.NumberFormat('ko-KR').format(value)
}

export function ProactiveReportCard({ report }: Readonly<{ report: M01ProactiveReport }>) {
  return (
    <li className={styles.proactiveReportRow}>
      <div className={styles.proactiveIntro}>
        <SoheeAvatar variant="hero" />
        <div>
          <strong>확인된 자료로 먼저 보고드려요.</strong>
          <p>{report.headline}</p>
        </div>
      </div>

      <article
        aria-label="최근 콘텐츠 반응 보고"
        className={styles.proactiveReport}
        data-v07-screen={report.screenId}
      >
        <header className={styles.reportArtifactHeader}>
          <span aria-hidden="true" className={styles.reportArtifactIcon}>
            <ChartNoAxesCombined strokeWidth={1.8} />
          </span>
          <div>
            <p>{report.periodLabel}</p>
            <h2>{report.headline}</h2>
          </div>
          <span className={styles.reportSourceState}>{report.sourceState}</span>
        </header>

        <p className={styles.reportSourceMessage}>{report.sourceMessage}</p>

        <dl aria-label="확인된 반응 지표" className={styles.reportMetricGrid}>
          {report.metrics.map((metric) => (
            <div data-known={metric.value !== null} key={metric.key}>
              <dt>{metric.label}</dt>
              <dd>{formatMetric(metric.value)}</dd>
            </div>
          ))}
        </dl>

        <div className={styles.reportInsight}>
          <Sparkles aria-hidden="true" strokeWidth={1.8} />
          <div>
            <strong>소희가 연결한 점</strong>
            <p>{report.insight}</p>
          </div>
        </div>

        <footer className={styles.reportArtifactActions}>
          <Link href="/app/reports?view=reactions">
            <MessageSquareText aria-hidden="true" strokeWidth={1.8} />
            {report.conversationCount === null ? '고객 대화 확인' : `고객 대화 ${report.conversationCount}건`}
          </Link>
          <Link href="/app/reports">
            리포트 전체 보기
            <ArrowRight aria-hidden="true" strokeWidth={1.8} />
          </Link>
        </footer>
      </article>
    </li>
  )
}
