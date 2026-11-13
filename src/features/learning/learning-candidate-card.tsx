type Candidate = Readonly<{
  observation: string
  interpretation: string
  impact: string
  channels: readonly string[]
  stopCondition: string
  status: 'candidate' | 'review_required' | 'approved' | 'rejected'
}>

export function LearningCandidateCard({ candidate }: Readonly<{ candidate: Candidate }>) {
  const inactive = candidate.status === 'candidate' || candidate.status === 'review_required'
  return <article aria-label="학습 후보" data-v08-screen="RP-04">
    <p>학습 후보</p><h2>{inactive ? '승인 전 비활성' : candidate.status === 'approved' ? '승인됨' : '반려됨'}</h2>
    <dl><div><dt>관찰</dt><dd>{candidate.observation}</dd></div><div><dt>해석</dt><dd>{candidate.interpretation}</dd></div><div><dt>적용하려는 항목</dt><dd>{candidate.impact}</dd></div><div><dt>영향 채널</dt><dd>{candidate.channels.join(', ')}</dd></div><div><dt>중단 조건</dt><dd>{candidate.stopCondition}</dd></div></dl>
    {inactive ? <p>다음 콘텐츠에 아직 적용되지 않아요.</p> : null}
    <div><button disabled>후보 승인</button><button disabled>수정 제안</button><button disabled>보류</button></div>
  </article>
}
