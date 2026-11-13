import type { BlogStrategyProposal } from './blog-strategy-proposal'

export function BlogStrategyBriefing({ proposal, dirty = false, blocked = false }: {
  proposal: BlogStrategyProposal; dirty?: boolean; blocked?: boolean
}) {
  const topic = proposal.selectedIndex === null ? null : proposal.topics[proposal.selectedIndex]
  const next = blocked ? '최신 정보로 다시 확인해 주세요. 확인 전에는 승인하거나 원고를 준비할 수 없어요.'
    : dirty ? '바꾼 선택·조건을 먼저 저장해 주세요. 아래 요약은 마지막으로 저장한 내용이에요.'
      : !topic ? '주제와 안내할 대상을 정해 주세요.'
        : proposal.status === 'approved' ? '비용을 확인한 뒤 원고 준비를 요청할 수 있어요. 외부 게시는 별도 승인이 필요해요.'
          : '주제·대상·조건과 가게 사실을 확인한 뒤 전략만 승인해 주세요.'

  return <div className="flex min-w-0 flex-col gap-4 break-words">
    {blocked ? <p role="status" className="rounded-lg border p-3 text-sm">아래는 마지막으로 저장한 요약이며 최신 내용으로 확인되지 않았어요. 다시 확인한 뒤 진행해 주세요.</p> : null}
    <section aria-label="현재 상황" className="rounded-lg bg-muted/50 p-4">
      <h3 className="mb-2 text-sm font-semibold">현재 상황</h3>
      <p className="text-xs text-muted-foreground">현재 가게 목표</p>
      <p className="mt-1 font-medium">{proposal.goal.description}</p>
      <p className="mt-2 text-sm text-muted-foreground">문의·예약·판매 성과는 이 전략의 선택이나 승인만으로 확인되지 않아요.</p>
    </section>
    <section aria-label="제안 기회" className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">제안 기회</h3>
      <p className="font-medium">{topic?.title ?? '아래에서 주제를 하나 골라 주세요.'}</p>
      {topic ? <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">안내 대상</dt><dd>{proposal.audience}</dd>
        <dt className="text-muted-foreground">반영 조건</dt><dd>{proposal.constraints || '별도로 정한 조건 없음'}</dd>
      </dl> : null}
      <p className="text-sm text-muted-foreground">승인된 가게 정보에서 생각한 주제예요. 실제 고객 질문이나 검색 수요를 관측한 결과는 아니에요.</p>
    </section>
    <details className="rounded-lg border px-3">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">근거와 아직 모르는 점</summary>
      <div className="flex flex-col gap-3 pb-4 text-sm">
        <p className="font-medium">{topic ? '저장한 주제의 근거' : '주제 선택 전'}</p>
        {topic ? <ul className="list-disc space-y-2 pl-5">{topic.evidence.map((evidence, index) => <li key={index}>{evidence}</li>)}</ul>
          : <p>주제를 선택하고 저장하면 해당 주제의 근거를 여기서 볼 수 있어요.</p>}
        <p className="font-medium">아직 모르는 점</p>
        <ul className="list-disc space-y-2 pl-5">{proposal.unknowns.map((unknown, index) => <li key={index}>{unknown}</li>)}</ul>
        <p className="text-muted-foreground">외부 검색·AI 답변 관측의 출처나 수집 시각이 없는 정보는 실제 관측 근거로 표시하지 않아요.</p>
      </div>
    </details>
    <section aria-label="다음 행동" className="rounded-lg border p-4" aria-live="polite">
      <h3 className="mb-2 text-sm font-semibold">다음 행동</h3>
      <p className="text-sm">{next}</p>
      <p className="mt-2 text-xs text-muted-foreground">실행 산출물: 검토할 블로그 원고와 이미지. 게시 확인과 사업 성과 확인은 이후 별도 단계예요.</p>
    </section>
  </div>
}
