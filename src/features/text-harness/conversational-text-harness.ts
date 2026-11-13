export interface ConversationalTextHarnessRules {
  brandVoice: string
  sentenceLength: 'SHORT' | 'MEDIUM' | 'LONG'
  callToAction: 'RESERVATION_LINK' | 'DM_INQUIRY' | 'PHONE_CALL' | 'NONE'
  priceDisclosure: 'TRANSPARENT' | 'INQUIRY' | 'NONE'
  antiExaggeration: boolean
  prohibitedWords: string[]
  instagramStyle: string
  threadsStyle: string
}

export interface ConversationalTextHarnessDraft {
  id?: string
  workspaceId: string
  rules: ConversationalTextHarnessRules
  testRunsCount: number
  status: 'DRAFT' | 'ACTIVE_CONFIRMED' | 'SUPERSEDED'
  confirmedAt?: string
  confirmedByUserId?: string
}

export interface TextCopyItem {
  id: string
  channel: 'instagram' | 'threads'
  title?: string
  text: string
  hashtags?: string[]
  revisionLineage?: {
    originalCopyId: string
    userCorrection?: string
    revisedAt: string
  }
}

export interface DualChannelTestBatch {
  updatedDraft: ConversationalTextHarnessDraft
  instagramCopies: TextCopyItem[]
  threadsCopies: TextCopyItem[]
  executedAt: string
}

export function extractTextHarnessRules(utterance: string): ConversationalTextHarnessRules {
  const text = utterance.trim()
  const lower = text.toLowerCase()

  // 1. Brand Voice
  let brandVoice = '다정하고 정중한 존댓말'
  if (lower.includes('다정') && lower.includes('정중')) {
    brandVoice = '다정하고 정중한 존댓말'
  } else if (lower.includes('발랄') || lower.includes('활기찬') || lower.includes('친구처럼')) {
    brandVoice = '발랄하고 친근한 이웃'
  } else if (lower.includes('전문적') || lower.includes('격식') || lower.includes('신뢰')) {
    brandVoice = '정중하고 전문적인 안내'
  } else if (text.match(/말투는?\s*([^\n,.]+)/)) {
    const match = text.match(/말투는?\s*([^\n,.]+)/)
    brandVoice = match ? match[1].trim() : brandVoice
  }

  // 2. Sentence Length
  let sentenceLength: 'SHORT' | 'MEDIUM' | 'LONG' = 'SHORT'
  if (lower.includes('긴 문장') || lower.includes('자세하게') || lower.includes('상세히')) {
    sentenceLength = 'LONG'
  } else if (lower.includes('적당한') || lower.includes('보통')) {
    sentenceLength = 'MEDIUM'
  }

  // 3. CTA
  let callToAction: 'RESERVATION_LINK' | 'DM_INQUIRY' | 'PHONE_CALL' | 'NONE' = 'DM_INQUIRY'
  if (lower.includes('예약 링크') || lower.includes('네이버 예약')) {
    callToAction = 'RESERVATION_LINK'
  } else if (lower.includes('전화')) {
    callToAction = 'PHONE_CALL'
  } else if (lower.includes('cta 없') || lower.includes('안내 생략')) {
    callToAction = 'NONE'
  }

  // 4. Price disclosure
  let priceDisclosure: 'TRANSPARENT' | 'INQUIRY' | 'NONE' = 'TRANSPARENT'
  if (lower.includes('가격은 문의') || lower.includes('가격 비공개') || lower.includes('dm 문의로')) {
    priceDisclosure = 'INQUIRY'
  }

  // 5. Anti-exaggeration & Prohibited words
  const antiExaggeration = !lower.includes('과장 허용')
  const prohibitedWords: string[] = []

  const prohibitedPatterns = [
    /['"]([^'"]+)['"]\s*(?:같은|등의)?\s*과장된\s*표현은?\s*절대\s*쓰지\s*마/,
    /['"]([^'"]+)['"]\s*금지/,
  ]

  for (const pat of prohibitedPatterns) {
    const m = text.match(pat)
    if (m && m[1]) {
      const parts = m[1].split(/[,\s]+/).filter(Boolean)
      prohibitedWords.push(...parts)
    }
  }

  if (lower.includes('대박 할인')) prohibitedWords.push('대박 할인')
  if (lower.includes('전국 최저가')) prohibitedWords.push('전국 최저가')
  if (lower.includes('초특가') && !prohibitedWords.includes('초특가')) prohibitedWords.push('초특가')

  const uniqueProhibited = Array.from(new Set(prohibitedWords))

  return {
    brandVoice,
    sentenceLength,
    callToAction,
    priceDisclosure,
    antiExaggeration,
    prohibitedWords: uniqueProhibited,
    instagramStyle: '감성적이고 정돈된 비주얼 캡션 및 핵심 해시태그',
    threadsStyle: '자연스럽고 솔직한 대화형 호흡 및 공감 유도',
  }
}

export function generateDualChannelTestCopies(
  draft: ConversationalTextHarnessDraft,
  sampleTopic: string
): DualChannelTestBatch {
  const { brandVoice, callToAction } = draft.rules

  let ctaText = '궁금한 점은 언제든 DM으로 편하게 남겨주세요.'
  if (callToAction === 'RESERVATION_LINK') {
    ctaText = '프로필 상단 네이버 예약 링크에서 바로 일정 확인이 가능합니다.'
  } else if (callToAction === 'PHONE_CALL') {
    ctaText = '매장 전화로 문의주시면 친절하게 안내해 드릴게요.'
  }

  const ig1: TextCopyItem = {
    id: `copy_ig_${Date.now()}_1`,
    channel: 'instagram',
    title: `${sampleTopic} 추천 소식`,
    text: `안녕하세요 사장님들! ✨ 이번 시즌 ${sampleTopic} 소식을 전해드려요.\n\n${brandVoice}으로 정성스럽게 준비했습니다. 기분 좋은 변화를 경험해 보세요.\n\n👉 ${ctaText}`,
    hashtags: ['#매장소식', '#스타일추천', '#동네소통'],
  }

  const ig2: TextCopyItem = {
    id: `copy_ig_${Date.now()}_2`,
    channel: 'instagram',
    title: `${sampleTopic} 디테일 안내`,
    text: `오늘도 소중한 발걸음 감사드립니다. 🌿\n${sampleTopic} 관련하여 많은 분들이 문의를 주셨어요. 사소한 디테일까지 신경 써서 맞이할게요.\n\n${ctaText}`,
    hashtags: ['#소희마케팅', '#1인매장', '#정성가득'],
  }

  const th1: TextCopyItem = {
    id: `copy_th_${Date.now()}_1`,
    channel: 'threads',
    text: `요즘 ${sampleTopic} 문의가 부쩍 늘었네요! 다들 계절 바뀔 때 산뜻한 기분 내고 싶으신가 봐요. 오늘 매장 활짝 열려 있습니다 ☕`,
  }

  const th2: TextCopyItem = {
    id: `copy_th_${Date.now()}_2`,
    channel: 'threads',
    text: `${sampleTopic} 준비하면서 느낀 건데, 역시 정성 들인 만큼 고객님들이 먼저 알아봐 주시네요. 궁금하신 점 댓글 주시면 답변드릴게요!`,
  }

  const updatedDraft: ConversationalTextHarnessDraft = {
    ...draft,
    testRunsCount: draft.testRunsCount + 1,
  }

  return {
    updatedDraft,
    instagramCopies: [ig1, ig2],
    threadsCopies: [th1, th2],
    executedAt: new Date().toISOString(),
  }
}

export function reviseTextHarnessCandidate(
  originalCopy: TextCopyItem,
  feedback: {
    feedbackType: 'liked' | 'disliked' | 'revised'
    userCorrection?: string
  }
): TextCopyItem {
  let newText = originalCopy.text

  if (feedback.userCorrection) {
    let matched = false
    if (feedback.userCorrection.includes('35,000원') || feedback.userCorrection.includes('가격')) {
      newText = `${newText}\n(시술 가격: 35,000원부터 안내)`
      matched = true
    }
    if (feedback.userCorrection.includes('예약 마감')) {
      newText = `${newText}\n⚠️ 이번 주 예약 마감 임박!`
      matched = true
    }
    if (!matched) {
      newText = `${newText}\n(사장님 피드백 반영: ${feedback.userCorrection})`
    }
  }

  return {
    ...originalCopy,
    id: `rev_${originalCopy.id}_${Date.now()}`,
    text: newText,
    revisionLineage: {
      originalCopyId: originalCopy.id,
      userCorrection: feedback.userCorrection,
      revisedAt: new Date().toISOString(),
    },
  }
}

export interface ConfirmHarnessGateParams {
  draft: ConversationalTextHarnessDraft
  userId: string
  userConfirmationPhrase?: string
  isExplicitlyApproved: boolean
}

export function confirmTextHarnessWithExplicitGate(
  params: ConfirmHarnessGateParams
): ConversationalTextHarnessDraft {
  const { draft, userId, userConfirmationPhrase, isExplicitlyApproved } = params

  if (!isExplicitlyApproved || !userConfirmationPhrase?.includes('이 기준으로 사용')) {
    throw new Error(
      "텍스트 하네스 확정을 위해서는 사용자의 명시적인 '이 기준으로 사용' 승인이 필요합니다. (Confirm Boundary Invariant)"
    )
  }

  if (draft.testRunsCount < 1) {
    throw new Error(
      '최소 1회 이상 테스트 생성을 실행해야 텍스트 하네스 기준을 확정할 수 있습니다. (Minimum 1 Test Run Invariant)'
    )
  }

  const confirmed: ConversationalTextHarnessDraft = {
    ...draft,
    id: draft.id || `th_confirmed_${Date.now()}`,
    status: 'ACTIVE_CONFIRMED',
    confirmedAt: new Date().toISOString(),
    confirmedByUserId: userId,
  }

  return Object.freeze(confirmed)
}
