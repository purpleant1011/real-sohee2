type StructuredReport = Readonly<{
  observations: readonly string[]
  interpretations: readonly string[]
  unknowns: readonly string[]
  proposal: string
  requiredDecision: string
}>

function Section({ title, items }: Readonly<{ title: string; items: readonly string[] }>) {
  return <section><h3>{title}</h3>{items.length ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p>아직 확인된 내용이 없어요.</p>}</section>
}

export function ProactiveReportCard({ report }: Readonly<{ report: StructuredReport }>) {
  return <article aria-label="정기 성과 보고" data-v08-screen="RP-01">
    <p>정기 성과 보고</p><Section title="확인된 변화" items={report.observations} /><Section title="가능한 해석" items={report.interpretations} /><Section title="아직 알 수 없는 부분" items={report.unknowns} />
    <section><h3>다음 방향 제안</h3><p>{report.proposal}</p></section><section><h3>사용자 결정</h3><p>{report.requiredDecision}</p></section>
    <button disabled>다음 방향 논의하기</button>
  </article>
}
