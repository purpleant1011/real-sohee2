export interface CandidateLineageEntry {
  version: number
  value: string
  sourceUtterance: string
  revisedAt: string
}

export interface LearningCandidate {
  key: string
  label: string
  value: string
  status: 'CANDIDATE' | 'CONFIRMED'
  version: number
  sourceUtterance: string
  previousValues: CandidateLineageEntry[]
}

/**
 * [ANI-1444] First Meeting Intent Extractor
 *
 * Extracts owner's expectations for Sohee:
 * - marketing_goal: What the owner wants Sohee to achieve
 * - brand_tone: Preferred tone or anti-patterns the owner dislikes
 *
 * Never elevates candidates directly to active/confirmed truth without explicit user gate.
 */
export function extractFirstMeetingIntent(utterance: string): LearningCandidate[] {
  const text = utterance.trim()
  const lower = text.toLowerCase()
  const results: LearningCandidate[] = []

  // If the utterance is an imperative post/publish command, it is an action command rather than meeting intent
  if (
    lower.includes('올려') ||
    lower.includes('게시') ||
    lower.includes('발행') ||
    lower.includes('업로드') ||
    lower.includes('포스팅')
  ) {
    return []
  }

  // 1. Goal Extraction (e.g. 인스타 홍보, 단골 소통, 예약 유치)
  if (text.includes('인스타') || text.includes('홍보') || text.includes('마케팅') || text.includes('소통')) {
    let goalValue = '인스타그램 홍보 중심 마케팅 대행'
    if (text.includes('인스타') && text.includes('홍보')) {
      goalValue = '인스타그램 홍보 및 피드 활성화'
    } else if (text.includes('소통') || text.includes('단골')) {
      goalValue = '단골 고객 소통 및 친근한 매장 안내'
    } else if (text.includes('예약')) {
      goalValue = '신규 고객 유치 및 예약 전환'
    }

    results.push({
      key: 'marketing_goal',
      label: '소희에게 바라는 역할',
      value: goalValue,
      status: 'CANDIDATE',
      version: 1,
      sourceUtterance: utterance,
      previousValues: [],
    })
  }

  // 2. Tone & Anti-Pattern Extraction (e.g. 광고 같은 말투 싫어, 담백하게)
  if (text.includes('광고') || text.includes('말투') || text.includes('과장') || text.includes('담백') || text.includes('솔직')) {
    let toneValue = '담백하고 솔직한 어조 (과장 및 지나친 광고형 어조 배제)'
    if (text.includes('광고') && (text.includes('싫') || text.includes('안') || text.includes('말'))) {
      toneValue = '과장된 광고형 말투 배제, 담백하고 진솔한 일상 어조'
    } else if (text.includes('친한 척') || text.includes('부담')) {
      toneValue = '과도한 친한 척 없는 정중하고 깔끔한 어조'
    } else if (text.includes('전문적')) {
      toneValue = '신뢰감을 주는 전문적인 어조'
    }

    results.push({
      key: 'brand_tone',
      label: '원하는 글쓰기 스타일',
      value: toneValue,
      status: 'CANDIDATE',
      version: 1,
      sourceUtterance: utterance,
      previousValues: [],
    })
  }

  return results
}

/**
 * [ANI-1445] Conversational Revision with Preserved Lineage
 *
 * When owner modifies or refines a candidate, retains full history of previous values
 * so no evidence or intent is destroyed.
 */
export function recordCandidateRevision(
  candidate: LearningCandidate,
  correctionUtterance: string,
  revisedValue: string
): LearningCandidate {
  const currentEntry: CandidateLineageEntry = {
    version: candidate.version,
    value: candidate.value,
    sourceUtterance: candidate.sourceUtterance,
    revisedAt: new Date().toISOString(),
  }

  return {
    ...candidate,
    version: candidate.version + 1,
    value: revisedValue,
    sourceUtterance: correctionUtterance,
    previousValues: [...candidate.previousValues, currentEntry],
    status: 'CANDIDATE', // Always remains candidate until explicit confirm
  }
}
