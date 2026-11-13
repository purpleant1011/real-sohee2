import { calculatePlaceHealth, type PlaceProfileSnapshot } from './profile-health'

const stateLabels = {
  good: '좋음', recommended: '개선 권장', missing: '정보 없음', needs_verification: '확인 필요', restricted: '수정 제한',
} as const

export function ProfileHealthCard({ snapshot }: Readonly<{ snapshot: PlaceProfileSnapshot }>) {
  const health = calculatePlaceHealth(snapshot)
  return <section aria-labelledby="place-health-title">
    <header>
      <p>CN-04 플레이스 건강 점검</p>
      <h1 id="place-health-title">{snapshot.targetLabel}</h1>
      <p>{snapshot.lastVerifiedAt ? `마지막 확인 ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(snapshot.lastVerifiedAt))}` : '아직 공식 화면에서 확인한 정보가 없어요.'}</p>
    </header>
    <ul aria-label="플레이스 정보 준비도">
      {health.items.map((item) => <li key={item.field}>
        <strong>{item.label}</strong>
        <span> · {stateLabels[item.state]}</span>
        <p>{item.nextAction}</p>
      </li>)}
    </ul>
    <p>값을 추정하거나 자동 변경하지 않아요. 확인된 값만 필드별 변경안으로 만들 수 있어요.</p>
  </section>
}
