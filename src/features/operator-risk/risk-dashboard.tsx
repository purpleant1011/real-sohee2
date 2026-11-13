import Link from 'next/link'
import type { OperatorRiskOverview, RiskItem } from './risk-schemas'
import styles from './risk-dashboard.module.css'

const severityLabel: Record<RiskItem['severity'], string> = { critical: '긴급', high: '높음', medium: '주의', low: '정보', unknown: '확인 전' }
const stateLabel: Record<OperatorRiskOverview['summary']['state'], string> = { fresh: '최근 확인', stale: '오래된 자료', unknown: '확인 전', empty: '자료 없음' }
const freshnessLabel: Record<'fresh' | 'stale' | 'unknown', string> = { fresh: '최근 확인', stale: '오래된 자료', unknown: '확인 전' }

function metadataLabel(metadata: OperatorRiskOverview['summary']['cardMetadata'][keyof OperatorRiskOverview['summary']['cardMetadata']]): string {
  const observedAt = metadata.observedAt ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(metadata.observedAt)) : '출처 시각 확인 전'
  return `${metadata.windowLabel} · ${metadata.sourceLabel} · 마지막 관측 ${observedAt} · ${freshnessLabel[metadata.freshness]}`
}

export function OperatorRiskDashboard({ overview }: Readonly<{ overview: OperatorRiskOverview }>) {
  const items = [...overview.items].sort((a, b) => ['critical', 'high', 'medium', 'low', 'unknown'].indexOf(a.severity) - ['critical', 'high', 'medium', 'low', 'unknown'].indexOf(b.severity))
  return <section className={styles.dashboard} aria-labelledby="operator-risk-dashboard-title">
    <header className={styles.heading}><div><h1 id="operator-risk-dashboard-title">운영 현황</h1><p>위험 우선으로 고객사 운영 상태를 확인합니다.</p></div><span className={styles.meta}>자료 상태 · {stateLabel[overview.summary.state]}</span></header>
    <section className={styles.summary} aria-label="핵심 지표 · 즉시 확인"><div className={styles.card}><span>긴급 · 즉시 확인</span><strong>{overview.summary.critical ?? '확인 전'}</strong><small>{metadataLabel(overview.summary.cardMetadata.critical)}</small></div><div className={styles.card}><span>활성 고객사</span><strong>{overview.summary.activeCount ?? '확인 전'}</strong><small>{metadataLabel(overview.summary.cardMetadata.activeCustomers)}</small></div><div className={styles.card}><span>승인 대기</span><strong>{overview.summary.pendingApprovalCount ?? '확인 전'}</strong><small>{metadataLabel(overview.summary.cardMetadata.pendingApprovals)}</small></div><div className={styles.card}><span>크레딧 위험</span><strong>{overview.summary.creditRiskCount ?? '확인 전'}</strong><small>{metadataLabel(overview.summary.cardMetadata.creditRisk)}</small></div><div className={styles.card}><span>전체 최신성</span><strong>{stateLabel[overview.summary.state]}</strong><small>{metadataLabel(overview.summary.cardMetadata.overall)}</small></div></section>
    <section className={styles.panel} aria-labelledby="risk-title"><div className={styles.panelHead}><h2 id="risk-title">운영 위험</h2><Link href="/admin/audit">감사 기록 보기</Link></div>{items.length === 0 ? <p className={styles.empty}>확인된 위험 항목이 없습니다. 자료가 없는 영역은 정상으로 간주하지 않습니다.</p> : <ul className={styles.list}>{items.map((item) => <li className={styles.item} key={item.id}><span className={`${styles.pill} ${styles[item.severity]}`}>{severityLabel[item.severity]}</span><span><Link href={item.href}>{item.title} · {item.workspace_name}</Link><small>{item.detail} · {item.fact_kind} · {item.freshness === 'fresh' ? '최근 확인' : item.freshness === 'stale' ? '오래된 자료' : '확인 전'}</small></span><small>{item.source_timestamp ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(item.source_timestamp)) : '출처 시각 확인 전'}</small></li>)}</ul>}</section>
    <p className={styles.meta}>원본 로그·provider payload·credential·PII는 이 대시보드에 노출하지 않습니다. 실제 근거가 없는 수치와 정상 판정은 표시하지 않습니다.</p>
  </section>
}
