export type GroundingDecision = 'pass' | 'review_required' | 'blocked'
export type GroundingIssue = Readonly<{ code: 'UNVERIFIED_EXPERIENCE' | 'UNSUPPORTED_PRECISION'; evidenceIds: readonly string[] }>
export type GroundingInput = Readonly<{ text: string; approvedFacts: readonly Readonly<{ id: string; text: string }>[]; firstPartyEvidence: boolean }>

const experienceSignal = /(제가|나는|내가|저희가).{0,24}(직접|사용해|경험해|다녀)/u
const precisionSignal = /(\d[\d,]*(?:원|%|일|주|개월|년)|\d+\s*(?:시간|분))/u

function evidenceIdsFor(text: string, facts: GroundingInput['approvedFacts']): string[] {
  return facts.filter((fact) => fact.text.length > 0 && text.includes(fact.text)).map((fact) => fact.id)
}

export function evaluateGrounding(input: GroundingInput): Readonly<{ decision: GroundingDecision; issues: readonly GroundingIssue[]; shouldRetryProvider: false }> {
  const evidenceIds = evidenceIdsFor(input.text, input.approvedFacts)
  const issues: GroundingIssue[] = []
  const hasUnsupportedExperience = experienceSignal.test(input.text) && !input.firstPartyEvidence
  if (hasUnsupportedExperience) issues.push({ code: 'UNVERIFIED_EXPERIENCE', evidenceIds })
  if (!hasUnsupportedExperience && precisionSignal.test(input.text) && evidenceIds.length === 0) issues.push({ code: 'UNSUPPORTED_PRECISION', evidenceIds: [] })
  const decision: GroundingDecision = issues.some((issue) => issue.code === 'UNVERIFIED_EXPERIENCE') ? 'blocked' : issues.length ? 'review_required' : 'pass'
  return Object.freeze({ decision, issues: Object.freeze(issues.map((issue) => Object.freeze({ ...issue, evidenceIds: Object.freeze([...issue.evidenceIds]) }))), shouldRetryProvider: false })
}
