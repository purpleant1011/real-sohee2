export const READINESS_RUBRIC_VERSION = '1.2.0'

export type ReadinessDimensionKey =
  | 'FACTUAL_SUPPORT'
  | 'READER_QUESTION_COVERAGE'
  | 'UNIQUENESS_AND_NOVELTY'
  | 'READABILITY'
  | 'IMAGE_RIGHTS_AND_CTA'

export interface ReadinessInputImage {
  sourceKind: 'OWNER_UPLOAD' | 'AI_ILLUSTRATION'
  rightsStatus: 'CONFIRMED' | 'UNCONFIRMED'
  altText?: string
  aiLabeled?: boolean
}

export interface ReadinessInput {
  title: string
  body: string
  tags: string[]
  approvedFacts?: string[]
  readerQuestions?: string[]
  priorPostTitles?: string[]
  images?: ReadinessInputImage[]
  hasCta?: boolean
  evaluatedAt?: string
}

export interface ReadinessDimensionResult {
  key: ReadinessDimensionKey
  maxScore: number
  rawScore: number | null
  status: 'ASSESSED' | 'NOT_ASSESSED' | 'BLOCKED'
  reason: string
  suggestedFixes: string[]
}

export interface ReadinessHardStop {
  code: string
  message: string
}

export interface ReadinessEvaluation {
  rubricVersion: string
  evaluatedAt: string
  dimensions: ReadinessDimensionResult[]
  hardStops: ReadinessHardStop[]
  totalIfComplete: number | null
  eligibility: 'READY' | 'REVIEW_REQUIRED' | 'NOT_READY' | 'INCOMPLETE'
  actionableFixes: string[]
  disclaimer: string
}

const DIMENSION_MAX_SCORES: Record<ReadinessDimensionKey, number> = {
  FACTUAL_SUPPORT: 30,
  READER_QUESTION_COVERAGE: 25,
  UNIQUENESS_AND_NOVELTY: 20,
  READABILITY: 15,
  IMAGE_RIGHTS_AND_CTA: 10,
}

const PRICE_DISCOUNT_PATTERN =
  /(?:[0-9,]+(?:\.\d+)?\s*(?:원|만원|천원|억원)|(?:\d+(?:\.\d+)?%|\d+퍼센트)\s*할인|\d+%\s*세일)/gu
const MEDICAL_CLAIM_PATTERN =
  /(?:완치|치료(?:됩니다|합니다|완료|보장)|100%\s*효과|효과\s*100%|의학적으로\s*입증|통증\s*완치)/u
const FIRST_PERSON_EXPERIENCE_PATTERN =
  /(?:제가|저는|내가)\s*직접\s*(?:받아보니|써보니|먹어보니|가보니|체험해보니|이용해보니)|직접\s*(?:받아보니|써보니|먹어보니|가보니|체험해보니|이용해보니)/u

function extractTokens(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []
}

function calculateJaccardSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 && tokensB.length === 0) return 1
  if (tokensA.length === 0 || tokensB.length === 0) return 0
  const setA = new Set(tokensA)
  const setB = new Set(tokensB)
  let intersectionCount = 0
  for (const token of setA) {
    if (setB.has(token)) intersectionCount++
  }
  const unionCount = new Set([...tokensA, ...tokensB]).size
  return unionCount === 0 ? 0 : intersectionCount / unionCount
}

function normalizeForComparison(text: string): string {
  return text.replace(/[\s,]/gu, '').toLowerCase()
}

/** 질문 형식을 나타낼 뿐 주제가 아닌 말. 본문에 들어 있을 이유가 없으므로 반영도 계산에서 뺀다. */
const QUESTION_FILLER_TOKENS: ReadonlySet<string> = new Set([
  '어떻게', '어떤', '무엇', '언제', '어디', '어디서', '얼마', '왜', '하나요', '있나요', '인가요', '되나요', '가능한가요', '할까요', '어떨까요', '건가요', '있을까요',
])

/** 한국어 어미·조사가 달라도 같은 어간이면 같은 말로 본다(앞 글자 최대 3자가 같은지). */
function sharesStem(a: string, b: string): boolean {
  const need = Math.min(3, a.length, b.length)
  return need >= 2 && a.slice(0, need) === b.slice(0, need)
}

export function evaluateEditorialReadiness(input: ReadinessInput): ReadinessEvaluation {
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString()
  const hardStops: ReadinessHardStop[] = []

  // 1. 하드스톱 검사
  // (1) 미승인 가격 / 할인 표현
  const priceMatches = [...input.body.matchAll(PRICE_DISCOUNT_PATTERN)].map((m) => m[0])
  if (priceMatches.length > 0) {
    const approvedNormalized = (input.approvedFacts ?? []).map(normalizeForComparison)
    const hasUnapprovedPrice = priceMatches.some((match) => {
      const normalizedMatch = normalizeForComparison(match)
      return !approvedNormalized.some((fact) => fact.includes(normalizedMatch))
    })
    if (hasUnapprovedPrice) {
      hardStops.push({
        code: 'UNAPPROVED_PRICE_CLAIM',
        message: '승인되지 않은 가격 또는 할인 표현이 본문에 포함되어 있습니다.',
      })
    }
  }

  // (2) 의학적 효능 단정 표현
  if (MEDICAL_CLAIM_PATTERN.test(input.body)) {
    hardStops.push({
      code: 'MEDICAL_CLAIM',
      message: '의학적 치료 효과나 완치를 단정하는 표현은 포함할 수 없습니다.',
    })
  }

  // (3) 허위 1인칭 후기 / 체험 단정
  if (FIRST_PERSON_EXPERIENCE_PATTERN.test(input.body)) {
    const approvedNormalized = (input.approvedFacts ?? []).map(normalizeForComparison)
    const hasApprovedExperience = approvedNormalized.some(
      (fact) => fact.includes('직접') || fact.includes('체험') || fact.includes('방문'),
    )
    if (!hasApprovedExperience) {
      hardStops.push({
        code: 'UNVERIFIED_FIRST_PERSON_EXPERIENCE',
        message: '확인된 방문·체험 사실 없이 1인칭 체험 후기를 작성할 수 없습니다.',
      })
    }
  }

  // (4) 이미지 권리 및 AI 라벨 확인
  let hasImageRightsStop = false
  let hasAiLabelStop = false
  if (input.images) {
    for (const image of input.images) {
      if (image.sourceKind === 'OWNER_UPLOAD' && image.rightsStatus === 'UNCONFIRMED') {
        hasImageRightsStop = true
      }
      if (image.sourceKind === 'AI_ILLUSTRATION' && image.aiLabeled !== true) {
        hasAiLabelStop = true
      }
    }
  }
  if (hasImageRightsStop) {
    hardStops.push({
      code: 'IMAGE_RIGHTS_UNCONFIRMED',
      message: '업로드된 이미지의 사용 권한이 확인되지 않았습니다.',
    })
  }
  if (hasAiLabelStop) {
    hardStops.push({
      code: 'AI_IMAGE_UNLABELED',
      message: '생성형 AI 이미지는 인공지능 생성물임을 명시해야 합니다.',
    })
  }

  // 2. 5개 차원별 점수 계산
  const dimensions: ReadinessDimensionResult[] = []

  // (1) FACTUAL_SUPPORT
  const hasFactualStop = hardStops.some(
    (h) =>
      h.code === 'UNAPPROVED_PRICE_CLAIM' ||
      h.code === 'MEDICAL_CLAIM' ||
      h.code === 'UNVERIFIED_FIRST_PERSON_EXPERIENCE',
  )
  if (input.approvedFacts === undefined) {
    dimensions.push({
      key: 'FACTUAL_SUPPORT',
      maxScore: DIMENSION_MAX_SCORES.FACTUAL_SUPPORT,
      rawScore: null,
      status: 'NOT_ASSESSED',
      reason: '승인된 사실 근거가 제공되지 않아 평가하지 않았습니다.',
      suggestedFixes: ['본문의 사실 관계를 확인하고 승인 근거를 등록해 주세요.'],
    })
  } else if (hasFactualStop) {
    dimensions.push({
      key: 'FACTUAL_SUPPORT',
      maxScore: DIMENSION_MAX_SCORES.FACTUAL_SUPPORT,
      rawScore: 0,
      status: 'BLOCKED',
      reason: '승인되지 않은 가격이나 의학적 효능 등 사실 왜곡 위험 표현이 있습니다.',
      suggestedFixes: [
        '미승인 가격/할인 표기를 삭제하거나 사실 근거를 승인해 주세요.',
        '완치나 100% 효과 등 단정적인 효능 표현을 객관적인 설명으로 완화해 주세요.',
      ].slice(0, 3),
    })
  } else {
    let score = 20
    const fixes: string[] = []
    if (input.approvedFacts.length > 0) {
      const bodyTokens = extractTokens(input.body)
      let reflectedCount = 0
      for (const fact of input.approvedFacts) {
        const factTokens = extractTokens(fact)
        const isReflected =
          factTokens.length === 0 || factTokens.some((token) => bodyTokens.includes(token))
        if (isReflected) {
          reflectedCount++
        } else {
          fixes.push(`승인된 사실('${fact.slice(0, 20)}') 관련 내용을 본문에 반영해 보세요.`)
        }
      }
      const ratio = reflectedCount / input.approvedFacts.length
      score = Math.round(15 + ratio * 15)
    } else {
      score = 25
    }
    dimensions.push({
      key: 'FACTUAL_SUPPORT',
      maxScore: DIMENSION_MAX_SCORES.FACTUAL_SUPPORT,
      rawScore: Math.min(DIMENSION_MAX_SCORES.FACTUAL_SUPPORT, Math.max(0, score)),
      status: 'ASSESSED',
      reason: '승인된 사실 근거를 바탕으로 원고가 작성되었습니다.',
      suggestedFixes: fixes.slice(0, 3),
    })
  }

  // (2) READER_QUESTION_COVERAGE
  if (input.readerQuestions === undefined) {
    dimensions.push({
      key: 'READER_QUESTION_COVERAGE',
      maxScore: DIMENSION_MAX_SCORES.READER_QUESTION_COVERAGE,
      rawScore: null,
      status: 'NOT_ASSESSED',
      reason: '독자 질문 목록이 제공되지 않아 평가하지 않았습니다.',
      suggestedFixes: ['독자가 궁금해할 주요 질문을 등록해 주세요.'],
    })
  } else if (input.readerQuestions.length === 0) {
    dimensions.push({
      key: 'READER_QUESTION_COVERAGE',
      maxScore: DIMENSION_MAX_SCORES.READER_QUESTION_COVERAGE,
      rawScore: null,
      status: 'NOT_ASSESSED',
      reason: '등록된 독자 질문이 없어 평가하지 않았습니다.',
      suggestedFixes: ['독자가 궁금해할 주요 질문을 등록해 주세요.'],
    })
  } else {
    const bodyTokens = extractTokens(input.body)
    let totalCoverage = 0
    const fixes: string[] = []
    for (const q of input.readerQuestions) {
      const qTokens = extractTokens(q).filter((token) => !QUESTION_FILLER_TOKENS.has(token))
      if (qTokens.length === 0) {
        totalCoverage += 1
        continue
      }
      const matchedCount = qTokens.filter((token) => bodyTokens.some((bodyToken) => sharesStem(token, bodyToken))).length
      const coverage = matchedCount / qTokens.length
      totalCoverage += coverage
      if (coverage < 0.5) {
        fixes.push(`질문 '${q.slice(0, 20)}'에 대한 답변 내용을 본문에 보강해 보세요.`)
      }
    }
    const avgCoverage = totalCoverage / input.readerQuestions.length
    const score = Math.round(avgCoverage * DIMENSION_MAX_SCORES.READER_QUESTION_COVERAGE)
    dimensions.push({
      key: 'READER_QUESTION_COVERAGE',
      maxScore: DIMENSION_MAX_SCORES.READER_QUESTION_COVERAGE,
      rawScore: Math.min(DIMENSION_MAX_SCORES.READER_QUESTION_COVERAGE, Math.max(0, score)),
      status: 'ASSESSED',
      reason: `독자 질문의 핵심 내용이 원고에 ${Math.round(avgCoverage * 100)}% 반영되었습니다.`,
      suggestedFixes: fixes.slice(0, 3),
    })
  }

  // (3) UNIQUENESS_AND_NOVELTY
  const titleTokens = extractTokens(input.title)
  let maxSimilarity = 0
  if (input.priorPostTitles && input.priorPostTitles.length > 0) {
    for (const priorTitle of input.priorPostTitles) {
      const priorTokens = extractTokens(priorTitle)
      const sim = calculateJaccardSimilarity(titleTokens, priorTokens)
      if (sim > maxSimilarity) maxSimilarity = sim
    }
  }
  let noveltyPenalty = 0
  const noveltyFixes: string[] = []
  if (maxSimilarity >= 0.7) {
    noveltyPenalty = 8
    noveltyFixes.push('이전 글과 제목이 매우 유사합니다. 새로운 관점을 담아 제목을 바꿔보세요.')
  } else if (maxSimilarity >= 0.5) {
    noveltyPenalty = 5
    noveltyFixes.push('이전 글과 유사한 단어가 많습니다. 차별화된 표현을 사용해 보세요.')
  } else if (maxSimilarity >= 0.3) {
    noveltyPenalty = 2
  }

  let noveltyBonus = 4
  if (input.approvedFacts && input.approvedFacts.length > 0) {
    const bodyTokens = extractTokens(input.body)
    const reflected = input.approvedFacts.filter((fact) =>
      extractTokens(fact).some((token) => bodyTokens.includes(token)),
    ).length
    noveltyBonus = Math.round((reflected / input.approvedFacts.length) * 6) + 2
  }
  const noveltyScore = Math.min(
    DIMENSION_MAX_SCORES.UNIQUENESS_AND_NOVELTY,
    Math.max(0, 14 - noveltyPenalty + noveltyBonus),
  )
  dimensions.push({
    key: 'UNIQUENESS_AND_NOVELTY',
    maxScore: DIMENSION_MAX_SCORES.UNIQUENESS_AND_NOVELTY,
    rawScore: noveltyScore,
    status: 'ASSESSED',
    reason:
      maxSimilarity >= 0.5
        ? '이전 게시글과 유사도가 다소 높아 고유한 관점 보강이 권장됩니다.'
        : '독창적인 제목과 새로운 내용으로 구성되었습니다.',
    suggestedFixes: noveltyFixes.slice(0, 3),
  })

  // (4) READABILITY
  const paragraphs = input.body
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const sentences = input.body
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const hasSubheading =
    /#{1,4}\s+/.test(input.body) ||
    /\[[^\]]+\]/.test(input.body) ||
    /【[^】]+】/.test(input.body) ||
    paragraphs.some((p) => p.length < 35 && !/[.!?]$/.test(p))

  let readabilityScore = 0
  const readabilityFixes: string[] = []

  // 소제목 (5점)
  if (hasSubheading) {
    readabilityScore += 5
  } else {
    readabilityFixes.push('문단 구분을 돕는 소제목을 추가해 가독성을 높여보세요.')
  }

  // 문단 구성 (5점) - 짧은 글이어도 최소 1문단 이상이면 충족
  if (paragraphs.length >= 1) {
    readabilityScore += 5
  }

  // 평균 문장 길이 (5점) - 짧아도 감점 사유 아님
  const avgSentenceLength =
    sentences.length > 0
      ? sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length
      : input.body.length

  if (avgSentenceLength <= 80) {
    readabilityScore += 5
  } else if (avgSentenceLength <= 120) {
    readabilityScore += 3
    readabilityFixes.push('문장이 다소 길어 호흡이 어렵습니다. 한 문장을 간결하게 나눠보세요.')
  } else {
    readabilityScore += 1
    readabilityFixes.push('한 문장이 지나치게 깁니다. 80자 내외로 끊어서 작성해 보세요.')
  }

  dimensions.push({
    key: 'READABILITY',
    maxScore: DIMENSION_MAX_SCORES.READABILITY,
    rawScore: Math.min(DIMENSION_MAX_SCORES.READABILITY, Math.max(0, readabilityScore)),
    status: 'ASSESSED',
    reason:
      readabilityScore >= 13
        ? '소제목과 간결한 문장 구조로 읽기 편하게 구성되었습니다.'
        : '문장 분리와 소제목 보완을 통해 가독성을 더욱 개선할 수 있습니다.',
    suggestedFixes: readabilityFixes.slice(0, 3),
  })

  // (5) IMAGE_RIGHTS_AND_CTA
  if (input.images === undefined) {
    dimensions.push({
      key: 'IMAGE_RIGHTS_AND_CTA',
      maxScore: DIMENSION_MAX_SCORES.IMAGE_RIGHTS_AND_CTA,
      rawScore: null,
      status: 'NOT_ASSESSED',
      reason: '이미지 정보가 제공되지 않아 평가하지 않았습니다.',
      suggestedFixes: ['원고에 사용할 이미지 및 권리 확인 정보를 등록해 주세요.'],
    })
  } else if (hasImageRightsStop || hasAiLabelStop) {
    const fixes: string[] = []
    if (hasImageRightsStop) fixes.push('소유자 업로드 이미지의 사용 권한을 확인해 주세요.')
    if (hasAiLabelStop) fixes.push('AI 생성 이미지에 AI 일러스트 라벨 표시를 설정해 주세요.')
    dimensions.push({
      key: 'IMAGE_RIGHTS_AND_CTA',
      maxScore: DIMENSION_MAX_SCORES.IMAGE_RIGHTS_AND_CTA,
      rawScore: 0,
      status: 'BLOCKED',
      reason: '이미지 사용 권한 미확인 또는 AI 이미지 표기 누락으로 검토가 필요합니다.',
      suggestedFixes: fixes.slice(0, 3),
    })
  } else {
    let imageScore = 5 // 기본 이미지 점수
    const allHaveAlt =
      input.images.length === 0 || input.images.every((img) => img.altText && img.altText.trim())
    if (allHaveAlt) {
      imageScore += 3
    }
    if (input.hasCta === true) {
      imageScore += 2
    }
    const fixes: string[] = []
    if (!allHaveAlt) {
      fixes.push('이미지에 대체 텍스트(altText)를 작성해 접근성을 높여보세요.')
    }
    if (input.hasCta !== true) {
      fixes.push('글 마지막에 독자를 위한 안내(CTA)를 추가해 보세요.')
    }
    dimensions.push({
      key: 'IMAGE_RIGHTS_AND_CTA',
      maxScore: DIMENSION_MAX_SCORES.IMAGE_RIGHTS_AND_CTA,
      rawScore: Math.min(DIMENSION_MAX_SCORES.IMAGE_RIGHTS_AND_CTA, Math.max(0, imageScore)),
      status: 'ASSESSED',
      reason: '이미지 권리 및 안내 문구(CTA) 요건을 충족했습니다.',
      suggestedFixes: fixes.slice(0, 3),
    })
  }

  // 3. totalIfComplete 계산: 5축 모두 ASSESSED 이고 hardStops가 비어있을 때만 0~100 정수
  const allAssessed = dimensions.every((d) => d.status === 'ASSESSED')
  const totalIfComplete =
    allAssessed && hardStops.length === 0
      ? Math.round(dimensions.reduce((sum, d) => sum + (d.rawScore ?? 0), 0))
      : null

  // 4. eligibility 계산
  let eligibility: ReadinessEvaluation['eligibility']
  if (hardStops.length > 0) {
    const hasFatalStop = hardStops.some(
      (h) =>
        h.code === 'UNAPPROVED_PRICE_CLAIM' ||
        h.code === 'MEDICAL_CLAIM' ||
        h.code === 'UNVERIFIED_FIRST_PERSON_EXPERIENCE',
    )
    if (hasFatalStop) {
      eligibility = 'NOT_READY'
    } else {
      // 이미지 권리/AI 라벨 문제만 있는 경우
      eligibility = 'REVIEW_REQUIRED'
    }
  } else if (!allAssessed) {
    eligibility = 'INCOMPLETE'
  } else if (totalIfComplete !== null) {
    if (totalIfComplete >= 75) {
      eligibility = 'READY'
    } else if (totalIfComplete >= 50) {
      eligibility = 'REVIEW_REQUIRED'
    } else {
      eligibility = 'NOT_READY'
    }
  } else {
    eligibility = 'NOT_READY'
  }

  // 5. actionableFixes (전체 최대 3개, 구체적)
  const actionableFixes: string[] = []
  for (const stop of hardStops) {
    actionableFixes.push(stop.message)
    if (actionableFixes.length >= 3) break
  }
  if (actionableFixes.length < 3) {
    for (const dim of dimensions) {
      for (const fix of dim.suggestedFixes) {
        if (!actionableFixes.includes(fix)) {
          actionableFixes.push(fix)
          if (actionableFixes.length >= 3) break
        }
      }
      if (actionableFixes.length >= 3) break
    }
  }

  return {
    rubricVersion: READINESS_RUBRIC_VERSION,
    evaluatedAt,
    dimensions,
    hardStops,
    totalIfComplete,
    eligibility,
    actionableFixes,
    disclaimer: '소희가 발행 전 원고를 점검한 내부 진단이며 네이버 검색 순위·노출과는 관련 없어요.',
  }
}
