import styles from './operator-dashboard.module.css'

type Metric = Readonly<{
  label: string
  value: string
  source: string
}>

const metrics: readonly Metric[] = [
  { label: '조회된 고객사', value: '수집 전', source: '고객사 시스템' },
  { label: '오늘 게시', value: '수집 전', source: '게시 운영' },
  { label: '승인 대기', value: '수집 전', source: '콘텐츠 승인' },
  { label: '이번 달 API 비용', value: '추적 연결 전', source: '비용 시스템' },
  { label: '이번 달 크레딧 사용', value: '추적 연결 전', source: '크레딧 시스템' },
]

const risks = [
  { icon: '!', title: '게시 실패', detail: '게시 결과 수집 전', tone: 'critical' },
  { icon: '△', title: '권한 만료 예정', detail: '채널 권한 추적 연결 전', tone: 'warning' },
  { icon: '○', title: '계약 동의 미완료', detail: '계약 동의 원장 수집 전', tone: 'notice' },
  { icon: '◷', title: '크레딧 한도 근접', detail: '크레딧 사용량 추적 연결 전', tone: 'warning' },
  { icon: 'i', title: 'API 비용 급증', detail: '비용 기준 계산 전', tone: 'neutral' },
] as const

const onboardingStages = ['가입 신청', '서류 검토 중', '계약 협의 중', '계약 동의 대기', '서비스 활성화']

type OperatorDashboardProps = Readonly<{
  workspaceSummary: Readonly<{
    count: number
    instagramConnected: number
    threadsConnected: number
  }> | null
}>

export function OperatorDashboard({ workspaceSummary }: OperatorDashboardProps) {
  const workspaceMetric = workspaceSummary === null ? '수집 전' : `${workspaceSummary.count}개`

  return (
    <section aria-labelledby="operator-dashboard-title" className={styles.dashboard}>
      <div className={styles.pageHeading}>
        <div>
          <p className={styles.kicker}>SOHEE OPERATOR</p>
          <h1 id="operator-dashboard-title">운영 현황</h1>
          <p className={styles.subtitle}>오늘의 서비스 상태를 한눈에 확인합니다.</p>
        </div>
        <div className={styles.headingMeta}>
          <span>운영사 관리자</span>
          <span className={styles.dataStatus}>데이터 연결 전</span>
        </div>
      </div>

      <section aria-labelledby="immediate-check-title" className={styles.alertBar}>
        <div className={styles.alertIcon} aria-hidden="true">!</div>
        <div>
          <h2 id="immediate-check-title">즉시 확인</h2>
          <p>운영 위험 수집 전</p>
        </div>
        <div className={styles.alertChips} aria-label="위험 상태">
          <span>게시 실패 <b>수집 전</b></span>
          <span>권한 만료 예정 <b>추적 연결 전</b></span>
          <span>계약 동의 미완료 <b>수집 전</b></span>
        </div>
        <a href="/admin/audit">모든 알림 보기 <span aria-hidden="true">›</span></a>
      </section>

      <section aria-labelledby="metrics-title" className={styles.section}>
        <div className={`${styles.sectionHeading} ${styles.metricsHeading}`}>
          <h2 id="metrics-title">핵심 지표</h2>
          <span>기준 기간 · 연결 전</span>
        </div>
        <div className={styles.metricGrid}>
          {metrics.map((metric) => (
            <article className={styles.metricCard} key={metric.label}>
              <h3>{metric.label}</h3>
              <strong>{metric.label === '조회된 고객사' ? workspaceMetric : metric.value}</strong>
              <p>데이터 출처 · {metric.source}</p>
            </article>
          ))}
        </div>
      </section>

      <div className={styles.primaryGrid}>
        <section aria-labelledby="trend-title" className={styles.panel}>
          <div className={styles.sectionHeading}>
            <h2 id="trend-title">게시 성공률과 API 비용</h2>
            <span>계산 기준 미설정</span>
          </div>
          <div className={styles.emptyChart} role="img" aria-label="게시 성공률과 API 비용 데이터 수집 전">
            <span className={styles.chartLine} aria-hidden="true" />
            <strong>추적 연결 전</strong>
            <p>게시 결과와 비용 원장이 연결되면 추이를 표시합니다.</p>
          </div>
        </section>

        <section aria-labelledby="risk-title" className={styles.panel}>
          <div className={styles.sectionHeading}>
            <h2 id="risk-title">운영 위험</h2>
            <a href="/admin/audit">모두 보기</a>
          </div>
          <ul className={styles.riskList}>
            {risks.map((risk) => (
              <li key={risk.title}>
                <span className={`${styles.riskIcon} ${styles[risk.tone]}`} aria-hidden="true">{risk.icon}</span>
                <span className={styles.riskCopy}><b>{risk.title}</b><small>{risk.detail}</small></span>
                <span className={`${styles.statusPill} ${styles[risk.tone]}`}>확인 전</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className={styles.secondaryGrid}>
        <section aria-labelledby="onboarding-title" className={styles.panel}>
          <div className={styles.sectionHeading}>
            <h2 id="onboarding-title">가입 진행 현황</h2>
            <span>수집 전</span>
          </div>
          <ol className={styles.funnel}>
            {onboardingStages.map((stage) => (
              <li key={stage}><span>{stage}</span><b>수집 전</b></li>
            ))}
          </ol>
          <p className={styles.panelFootnote}>기준: 진행 중 고객사 · 가입 데이터 연결 전</p>
        </section>

        <section aria-labelledby="events-title" className={styles.panel}>
          <div className={styles.sectionHeading}>
            <h2 id="events-title">최근 운영 이벤트</h2>
            <a href="/admin/audit">모두 보기</a>
          </div>
          <div className={styles.emptyEvents}>
            <span aria-hidden="true">◷</span>
            <strong>감사 이벤트 수집 전</strong>
            <p>운영 활동과 결과가 연결되면 최근 이벤트를 표시합니다.</p>
          </div>
        </section>
      </div>
    </section>
  )
}
