import type { OperatorIncident } from './schemas'

const stateLabel: Record<OperatorIncident['status'], string> = { open: '열림', acknowledged: '확인됨', resolved: '해결됨' }
const severityLabel: Record<OperatorIncident['severity'], string> = { low: '낮음', medium: '보통', high: '높음', critical: '긴급' }

export function IncidentReadSection({ data, error }: Readonly<{ data: Readonly<{ items: readonly OperatorIncident[] }> | null; error: string | null }>) {
  const items = data?.items ?? []
  return <section aria-labelledby="operator-incident-title" className="admin-panel">
    <header><h2 id="operator-incident-title">사고 원장·복구 시간선</h2><p>관측된 사실과 복구 검증을 추가 전용으로 확인합니다.</p></header>
    {error ? <p role="alert">사고 원장을 안전하게 불러오지 못했습니다.</p> : items.length === 0 ? <p>사고 원장 자료가 없습니다.</p> : <div className="admin-table-wrap"><table><caption className="sr-only">사고 원장</caption><thead><tr><th>사고</th><th>심각도</th><th>상태</th><th>사실 구분</th><th>관측 source</th><th>담당·영향</th><th>복구 근거</th><th>시간선</th></tr></thead><tbody>{items.map((incident) => <tr key={incident.id}><th scope="row">{incident.title}<small>{incident.reason}</small></th><td>{severityLabel[incident.severity]}</td><td>{stateLabel[incident.status]}</td><td>{incident.factKind}</td><td>{incident.source}<small>{incident.sourceFreshness}</small></td><td>{incident.assigneeDisplay ?? '담당자 확인 전'}<small>{incident.impactScope ?? '영향 범위 확인 전'}</small></td><td>{incident.recoveryState}<small>{incident.rollbackCandidateCode ?? '후보 확인 전'}</small><small>{incident.recoveryVerifiedAt ? new Date(incident.recoveryVerifiedAt).toLocaleString('ko-KR') : '복구 시각 확인 전'}</small><small>{incident.recoveryEvidenceSummary ?? '복구 근거 확인 전'}</small><small>{incident.remediationKind ? `${incident.remediationKind}: ${incident.remediationResult ?? '결과 확인 전'}` : '되돌리기·재발 방지 결과 확인 전'}</small></td><td>{incident.timeline.length}개</td></tr>)}</tbody></table></div>}
    <p>복구 실행은 승인 경계 연결 전까지 비활성화됩니다.</p><button type="button" disabled>복구 실행</button>
  </section>
}
