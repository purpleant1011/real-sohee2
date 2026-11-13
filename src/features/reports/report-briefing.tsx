import { AppLink as Link } from '@/components/navigation/app-link'
import {
  ArrowRight,
  Bookmark,
  CalendarDays,
  CalendarPlus2,
  CheckCircle2,
  CircleAlert,
  MessageSquareText,
  Sparkles,
  UserRound,
} from 'lucide-react'
import type { ReportExperience, ReportSampleState } from './types'
import { SOHEE_BUILD_ID } from '@/lib/build-identity'
import { ReportTrendChart } from './report-trend-chart'
import styles from './report-dashboard.module.css'

const sampleLabels: Readonly<Record<ReportSampleState, string>> = {
  sufficient: '근거 확인됨',
  limited: '근거 제한',
  collecting: '자료 수집 중',
  unavailable: '연결 확인 필요',
}

function periodLabel(start: string, end: string): string {
  const format = (value: string) => {
    const [year, month, day] = value.slice(0, 10).split('-')
    return year && month && day ? `${Number(month)}. ${Number(day)}.` : value
  }
  return `${format(start)} - ${format(end)}`
}

const evidenceIcons = { saved: Bookmark, visits: UserRound, inquiries: CircleAlert, reservations: CalendarDays } as const

function confidenceLabel(experience: ReportExperience) {
  return experience.primaryInsight.confidence === 'strong' ? '높음' : experience.primaryInsight.confidence === 'moderate' ? '보통' : '제한'
}

export function ReportBriefingView({
  experience,
  sampleState,
  periodQuery = '',
}: Readonly<{
  experience: ReportExperience
  sampleState: ReportSampleState
  periodQuery?: string
}>) {
  const insightHref = `/app/reports?${periodQuery ? `${periodQuery}&` : ''}insight=${encodeURIComponent(experience.primaryInsight.id)}`
  const planHref = `${insightHref}&action=plan`
  const experimentHref = `${insightHref}&action=experiment`
  const healthySources = experience.dataHealth.filter((source) => source.state === 'available' || source.state === 'confirmed_zero').length

  return (
    <div className={styles.briefingPage}>
      <header className={styles.briefingHeader}>
        <div>
          <p className={styles.eyebrow}>오늘의 경영 브리핑</p>
          <h1 id="report-title">{experience.briefing.title}</h1>
          <p>핵심 변화와 다음 행동을 한눈에 정리했어요.</p>
        </div>
        <div className={styles.briefingHeaderActions}>
          <span className={styles.periodControl}><CalendarDays aria-hidden="true" />{periodLabel(experience.briefing.periodStart, experience.briefing.periodEnd)}</span>
          <span className={styles.sampleBadge} data-state={sampleState}>{sampleLabels[sampleState]}</span>
        </div>
      </header>

      <div className={styles.briefingHero}>
        <section aria-labelledby="briefing-insight-title" className={styles.trendPanel}>
          <div className={styles.trendHeading}>
            <div>
              <p>가장 중요한 변화</p>
              <h2 id="briefing-insight-title">{experience.primaryInsight.title}</h2>
            </div>
          </div>
          <ReportTrendChart points={experience.trend} />
          <p className={styles.trendNote}><Sparkles aria-hidden="true" />{experience.primaryInsight.observedFacts[0]}</p>
          <Link className={styles.inlineDetailLink} href={insightHref}>
            인사이트 근거 상세 보기 <ArrowRight aria-hidden="true" />
          </Link>
        </section>

        <aside className={styles.priorityPanel}>
          <div className={styles.priorityLabel}><Sparkles aria-hidden="true" />이번 주 가장 중요한 일</div>
          <h2>저장 반응이 높았던 흐름을 상담 질문형으로 다시 만들어보세요.</h2>
          <p>{experience.primaryInsight.interpretations[0]}</p>
          <Link className={styles.primaryAction} href={planHref}>
            <MessageSquareText aria-hidden="true" />
            {experience.briefing.primaryActionLabel}
          </Link>
          <Link className={styles.secondaryAction} href={experimentHref}>
            <CalendarPlus2 aria-hidden="true" />
            다음 주 일정에 추가
          </Link>
          <small>대화나 일정을 열어도 게시가 자동 실행되지 않아요.</small>
        </aside>
      </div>

      <section aria-labelledby="briefing-evidence-title" className={styles.evidenceSummary}>
        <header>
          <div>
            <p>확인된 자료만 사용</p>
            <h2 id="briefing-evidence-title">근거가 된 변화</h2>
          </div>
          <Link href={`/app/reports?${periodQuery ? `${periodQuery}&` : ''}surface=data-health`}>데이터 상태 보기</Link>
        </header>
        <div className={styles.evidenceTableWrap}>
          <table>
            <thead><tr><th>지표</th><th>이번 주</th><th>지난 주</th><th>변화</th><th>신뢰도</th><th>출처</th></tr></thead>
            <tbody>{experience.briefing.evidence.slice(0, 3).map((item) => {
              const Icon = evidenceIcons[item.key]
              const currentUsable = item.state === 'available' || item.state === 'confirmed_zero'
              return <tr data-state={item.state} key={item.key}>
                <th><span className={styles.metricIcon}><Icon aria-hidden="true" /></span><span>{item.label}<small>{currentUsable ? '연결된 채널 확인값' : item.displayValue}</small></span></th>
                <td data-label="이번 주">{item.displayValue}</td>
                <td data-label="지난 주">{item.previousValue === null ? '비교 대기' : `${item.previousValue}건`}</td>
                <td data-label="변화" data-positive={item.changePercent !== null && item.changePercent > 0}>{item.changePercent === null ? '—' : `${item.changePercent >= 0 ? '+' : ''}${item.changePercent}%`}</td>
                <td data-label="신뢰도"><em>{confidenceLabel(experience)}</em></td>
                <td data-label="출처">채널 연결값</td>
              </tr>
            })}</tbody>
          </table>
        </div>
      </section>

      <Link className={styles.dataHealthBar} href={`/app/reports?${periodQuery ? `${periodQuery}&` : ''}surface=data-health`}>
        <CheckCircle2 aria-hidden="true" />
        <strong>데이터 상태</strong>
        <span>{healthySources}개 연결 정상 · 릴리스 {SOHEE_BUILD_ID}</span>
        <ArrowRight aria-hidden="true" />
      </Link>
    </div>
  )
}
