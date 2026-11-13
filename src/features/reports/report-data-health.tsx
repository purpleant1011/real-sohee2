import { AppLink as Link } from '@/components/navigation/app-link'
import { ArrowLeft, CheckCircle2, CircleAlert, Clock3, Database, ShieldCheck } from 'lucide-react'
import type { DataHealthSource, MetricState } from './types'
import styles from './report-dashboard.module.css'

const stateLabels: Readonly<Record<MetricState, string>> = {
  available: '정상',
  confirmed_zero: '확인된 0건',
  collecting: '수집 중',
  stale: '수집 지연',
  not_supported: '현재 미지원',
  permission_denied: '권한 필요',
  failed: '수집 실패',
}

function StateIcon({ state }: Readonly<{ state: MetricState }>) {
  if (state === 'available' || state === 'confirmed_zero') return <CheckCircle2 aria-hidden="true" />
  if (state === 'permission_denied' || state === 'failed') return <CircleAlert aria-hidden="true" />
  if (state === 'stale' || state === 'collecting') return <Clock3 aria-hidden="true" />
  return <Database aria-hidden="true" />
}

export function ReportDataHealth({ sources, periodQuery = '' }: Readonly<{ sources: readonly DataHealthSource[]; periodQuery?: string }>) {
  const priority = sources.find((source) => source.actionHref !== null) ?? null
  const normalCount = sources.filter((source) => source.state === 'available' || source.state === 'confirmed_zero').length
  const attentionCount = sources.filter((source) => source.state === 'permission_denied' || source.state === 'failed' || source.state === 'stale').length
  const unsupportedCount = sources.filter((source) => source.state === 'not_supported').length

  return (
    <div className={styles.analysisPage}>
      <Link className={styles.backLink} href={`/app/reports${periodQuery ? `?${periodQuery}` : ''}`}><ArrowLeft aria-hidden="true" />브리핑으로 돌아가기</Link>
      <header className={styles.analysisHeader}>
        <div><p>리포트 · 데이터 상태</p><h1 id="report-title">어떤 자료를 믿고 볼 수 있는지 알려드려요</h1><span>수집 전과 실제 0건, 지연과 미지원을 분명하게 구분해요.</span></div>
        <div className={styles.healthSummary}><span>{normalCount}개 정상</span><span>{attentionCount}개 확인 필요</span><span>{unsupportedCount}개 미지원</span></div>
      </header>
      <section aria-label="데이터 연결 상태 요약" className={styles.healthStats}><div><strong>{normalCount}개</strong><span>정상</span></div><div><strong>{attentionCount}개</strong><span>확인 필요</span></div><div><strong>{unsupportedCount}개</strong><span>미지원</span></div><div><strong>{sources.length}개</strong><span>전체 연결</span></div></section>

      <div className={styles.analysisGrid}>
        <section aria-labelledby="data-source-title" className={styles.dataSourcePanel}>
          <header><h2 id="data-source-title">연결 자료</h2><span>마지막 정상 수집 기준</span></header>
          <ul>
            {sources.map((source) => (
              <li data-state={source.state} key={source.id}>
                <StateIcon state={source.state} />
                <div><strong>{source.label}</strong><span>{source.lastCollectedAt ?? '수집 기록 없음'}</span></div>
                <em>{stateLabels[source.state]}</em>
                {source.actionHref ? <Link href={source.actionHref}>확인</Link> : null}
              </li>
            ))}
          </ul>
          <div className={styles.healthPrinciples}>
            <ShieldCheck aria-hidden="true" />
            <div><strong>자료가 부족할 때 소희가 지키는 원칙</strong><span>수집 전은 0이 아니며, 원인을 단정하지 않고, 마지막 정상값과 시각을 보여드려요.</span></div>
          </div>
        </section>

        <aside className={styles.recoveryPanel}>
          <p>지금 필요한 조치</p>
          <h2>{priority === null ? '필요한 연결 조치가 없어요' : `${priority.label} 다시 확인`}</h2>
          <span>{priority === null ? '현재 연결 상태를 그대로 유지할 수 있어요.' : '권한 또는 연결 상태를 확인하면 영향을 받는 지표 수집이 다시 시작돼요.'}</span>
          {priority?.actionHref ? <Link className={styles.primaryAction} href={priority.actionHref}>연결 확인하기</Link> : null}
          <Link className={styles.secondaryAction} href={`/app/reports${periodQuery ? `?${periodQuery}` : ''}`}>나중에</Link>
          <small>연결을 다시 해도 게시하거나 메시지를 보내지 않아요.</small>
        </aside>
      </div>
    </div>
  )
}
