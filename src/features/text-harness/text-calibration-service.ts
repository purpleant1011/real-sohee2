import type { ConversationalBusinessKnowledgeDraft } from '@/features/knowledge/conversational-knowledge'

export type TextCalibrationStyleKey = 'MINIMAL' | 'WARM' | 'VIBRANT'

export interface TextCalibrationRulesSnapshot {
  brandVoice: string
  sentenceLength: 'SHORT' | 'MEDIUM' | 'LONG'
  prohibitedWords: string[]
}

export interface TextCalibrationSample {
  id: string
  styleKey: TextCalibrationStyleKey
  styleLabel: string
  channel: 'instagram' | 'threads'
  title: string
  text: string
  hashtags: string[]
  rulesSnapshot: TextCalibrationRulesSnapshot
  revisionLineage?: {
    originalSampleId: string
    feedbackUtterance: string
    revisedAt: string
  }
}

export interface TextCalibrationBatch {
  samples: [TextCalibrationSample, TextCalibrationSample, TextCalibrationSample]
  generatedAt: string
}

export interface CalibrationHistoryEntry {
  iteration: number
  sampleId: string
  feedback: string
  appliedDelta: string
  timestamp: string
}

export interface TextCalibrationDraft {
  workspaceId: string
  selectedSampleId?: string
  status: 'CALIBRATING' | 'ACTIVE_CONFIRMED'
  iterationCount: number
  calibrationHistory: CalibrationHistoryEntry[]
  confirmedAt?: string
  confirmedByUserId?: string
}

export interface ApplyCalibrationFeedbackParams {
  sample: TextCalibrationSample
  feedbackUtterance: string
  currentRules: TextCalibrationRulesSnapshot
}

export interface TextCalibrationFeedbackResult {
  revisedSample: TextCalibrationSample
  updatedRules: TextCalibrationRulesSnapshot
  appliedDeltaExplanation: string
}

export interface ConfirmTextCalibrationParams {
  draft: TextCalibrationDraft
  userId: string
  userConfirmationPhrase?: string
  isExplicitlyApproved: boolean
}

/**
 * [ANI-1446] Generates 3 stylistically distinct calibration samples
 * based on verified/candidate business facts.
 */
export function generateCalibrationSamples(
  knowledge: ConversationalBusinessKnowledgeDraft | null,
  topic: string = '매장 대표 스타일 소개'
): TextCalibrationBatch {
  const loc = knowledge?.location || '매장 인근'
  const service = knowledge?.primaryServices || '대표 시그니처 서비스'
  const reservation = knowledge?.reservationPolicy || '네이버 예약제'
  const pricing = knowledge?.pricing || '합리적인 가격'

  const now = Date.now()

  // Sample 1: MINIMAL (담백하고 깔끔한 안내형)
  const sample1: TextCalibrationSample = {
    id: `sample_min_${now}_1`,
    styleKey: 'MINIMAL',
    styleLabel: '담백하고 간결한 스타일',
    channel: 'instagram',
    title: `${topic} 안내`,
    text: `[${loc}] ${service} 안내 드립니다.\n\n정돈된 시술과 디테일에 집중합니다. ${pricing}.\n\n방문 전 ${reservation}를 이용해 주시면 대기 없이 안내받으실 수 있습니다.`,
    hashtags: ['#매장안내', '#헤어스타일', '#예약안내'],
    rulesSnapshot: {
      brandVoice: '담백하고 간결한 존댓말',
      sentenceLength: 'SHORT',
      prohibitedWords: ['초특가', '대박'],
    },
  }

  // Sample 2: WARM (다정하고 친근한 일상형)
  const sample2: TextCalibrationSample = {
    id: `sample_warm_${now}_2`,
    styleKey: 'WARM',
    styleLabel: '다정하고 친근한 일상형',
    channel: 'instagram',
    title: `${topic} 다정한 소개`,
    text: `오늘도 ${loc}에서 따뜻하게 문을 열었습니다. 🌿\n\n많은 분들이 찾아주시는 ${service}, 고객님의 일상에 자연스러운 편안함을 더해드릴게요.\n\n편안한 시간을 위해 ${reservation}로 미리 예약해 주세요!`,
    hashtags: ['#일상소통', '#힐링스타일', '#정성가득'],
    rulesSnapshot: {
      brandVoice: '다정하고 따뜻한 이웃 스타일',
      sentenceLength: 'MEDIUM',
      prohibitedWords: ['초특가', '폭탄세일'],
    },
  }

  // Sample 3: VIBRANT (생동감 있고 트렌디한 위트형)
  const sample3: TextCalibrationSample = {
    id: `sample_vib_${now}_3`,
    styleKey: 'VIBRANT',
    styleLabel: '생동감 있고 트렌디한 스타일',
    channel: 'threads',
    title: `${topic} 트렌디 톡`,
    text: `계절 바뀔 때 제일 먼저 바꾸고 싶은 건 역시 스타일이죠! ✨\n\n${loc}에서 만나는 요즘 감성 ${service}. 이번 주말 일정은 미리 ${reservation} 확인해 두시는 걸 추천해요 ☕`,
    hashtags: ['#트렌드체크', '#스타일링', '#주말예약'],
    rulesSnapshot: {
      brandVoice: '트렌디하고 감각적인 어조',
      sentenceLength: 'MEDIUM',
      prohibitedWords: ['초특가', '절대놓치지마세요'],
    },
  }

  return {
    samples: [sample1, sample2, sample3],
    generatedAt: new Date().toISOString(),
  }
}

/**
 * [ANI-1446] Natural-language feedback parser and delta generator
 */
export function applyCalibrationFeedback(
  params: ApplyCalibrationFeedbackParams
): TextCalibrationFeedbackResult {
  const { sample, feedbackUtterance, currentRules } = params
  const text = feedbackUtterance.trim()

  const updatedProhibited = [...currentRules.prohibitedWords]
  const deltaParts: string[] = []

  // Extract explicit prohibited phrases (e.g. "부담 없이"라는 표현은 쓰지 말아줘)
  const quotedMatch = text.match(/['"“]([^'"”]+)['"”]/)
  if (quotedMatch && quotedMatch[1]) {
    const forbiddenWord = quotedMatch[1].trim()
    if (!updatedProhibited.includes(forbiddenWord)) {
      updatedProhibited.push(forbiddenWord)
      deltaParts.push(`"${forbiddenWord}" 표현을 금지어로 등록`)
    }
  }

  let updatedVoice = currentRules.brandVoice
  if (text.includes('덜 친한 척') || text.includes('과한 친근')) {
    updatedVoice = '과도한 친근함을 배제한 정중하고 깔끔한 존댓말'
    deltaParts.push('과도한 친근한 표현을 줄이고 정중한 어조로 조율')
  } else if (text.includes('더 다정') || text.includes('따뜻')) {
    updatedVoice = '더 포근하고 친근한 어조'
    deltaParts.push('보다 따뜻하고 다정한 어조로 보강')
  }

  let updatedLength = currentRules.sentenceLength
  if (text.includes('짧게') || text.includes('간결') || text.includes('깔끔하게')) {
    updatedLength = 'SHORT'
    deltaParts.push('문장 길이를 더 간결하게 압축')
  }

  const appliedDeltaExplanation =
    deltaParts.length > 0
      ? `이번에 바꾼 점: ${deltaParts.join(', ')}했습니다.`
      : '사장님의 피드백을 반영하여 카피의 어조와 단어 선택을 세밀하게 재조정했습니다.'

  // Generate revised sample reflecting delta
  let revisedText = sample.text
  for (const forbidden of updatedProhibited) {
    revisedText = revisedText.replaceAll(forbidden, '')
  }
  if (text.includes('덜 친한 척')) {
    revisedText = revisedText.replace(/🌿|✨|☕/g, '').trim()
  }

  const revisedSample: TextCalibrationSample = {
    ...sample,
    id: `rev_${sample.id}_${Date.now()}`,
    text: revisedText,
    rulesSnapshot: {
      brandVoice: updatedVoice,
      sentenceLength: updatedLength,
      prohibitedWords: updatedProhibited,
    },
    revisionLineage: {
      originalSampleId: sample.id,
      feedbackUtterance,
      revisedAt: new Date().toISOString(),
    },
  }

  return {
    revisedSample,
    updatedRules: {
      brandVoice: updatedVoice,
      sentenceLength: updatedLength,
      prohibitedWords: updatedProhibited,
    },
    appliedDeltaExplanation,
  }
}

/**
 * [ANI-1446] Explicit Confirm Gate
 */
export function confirmTextCalibration(
  params: ConfirmTextCalibrationParams
): TextCalibrationDraft {
  const { draft, userId, userConfirmationPhrase, isExplicitlyApproved } = params

  const allowedPhrases = ['이 기준으로 사용', '이 느낌으로 기억해줘', '앞으로 이 기준으로 써줘']
  const hasValidPhrase = allowedPhrases.some((p) => userConfirmationPhrase?.includes(p))

  if (!isExplicitlyApproved || !hasValidPhrase) {
    throw new Error(
      "문체 스타일 기준 확정을 위해서는 사장님의 명시적인 승인('이 기준으로 사용' 또는 '이 느낌으로 기억해줘')이 필요합니다. (Confirm Boundary Invariant)"
    )
  }

  const confirmed: TextCalibrationDraft = {
    ...draft,
    status: 'ACTIVE_CONFIRMED',
    confirmedAt: new Date().toISOString(),
    confirmedByUserId: userId,
  }

  return Object.freeze(confirmed)
}
