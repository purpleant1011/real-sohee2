/**
 * SOHEE V0.91 · M2 Text Harness Manager (HF-14, HF-15)
 * 
 * Rules:
 * 1. Immutable Active Version: Confirmed version is never overwritten directly.
 * 2. Minimum 1 Test Run: User MUST execute at least one test copy generation
 *    before confirming a Text Harness version.
 * 3. Dual Target Output: Default test run generates 2 Instagram copies + 2 Threads copies.
 * 4. Education Test Budget: Test runs in pre-ready state use EDUCATION_TEST_BUDGET.
 */

export interface TextHarnessRules {
  toneAndManner: string
  targetAudience: string
  keyPhrases: string[]
  prohibitedWords: string[]
  positiveExamples: string[]
  negativeExamples: string[]
}

export type TextHarnessStatus = 'DRAFT' | 'ACTIVE_CONFIRMED' | 'SUPERSEDED'

export interface TextHarnessVersion {
  id: string
  workspaceId: string
  versionNumber: number
  status: TextHarnessStatus
  rules: TextHarnessRules
  testRunsCount: number
  createdAt: string
  confirmedAt?: string
  confirmedByUserId?: string
}

export interface GeneratedCopyItem {
  id: string
  channel: 'instagram' | 'threads'
  title?: string
  text: string
  recommendedHashtags: string[]
}

export interface TextHarnessTestResult {
  updatedDraft: TextHarnessVersion
  instagramCopies: GeneratedCopyItem[]
  threadsCopies: GeneratedCopyItem[]
  executedAt: string
}

export function createTextHarnessDraft(params: {
  workspaceId: string
  rules: TextHarnessRules
  versionNumber: number
}): TextHarnessVersion {
  return {
    id: `th_draft_${Date.now()}_v${params.versionNumber}`,
    workspaceId: params.workspaceId,
    versionNumber: params.versionNumber,
    status: 'DRAFT',
    rules: { ...params.rules },
    testRunsCount: 0,
    createdAt: new Date().toISOString(),
  }
}

/**
 * HF-15: Run Text Harness Test Generation
 * Generates 2 Instagram + 2 Threads copy variants based on rules.
 */
export function runTextHarnessTest(params: {
  draft: TextHarnessVersion
  sampleTopic: string
}): TextHarnessTestResult {
  const { draft, sampleTopic } = params
  const { toneAndManner, keyPhrases } = draft.rules

  const phraseHighlight = keyPhrases.length > 0 ? keyPhrases.join(', ') : '정성 담은 메뉴'

  const instagramCopies: GeneratedCopyItem[] = [
    {
      id: `ig_test_${Date.now()}_1`,
      channel: 'instagram',
      title: `${sampleTopic} 이야기`,
      text: `안녕하세요 사장님들! ✨ ${sampleTopic}에 맞추어 [${phraseHighlight}]를 준비했습니다. ${toneAndManner}로 고객님들의 하루를 응원합니다. 편안하게 들러주세요!`,
      recommendedHashtags: ['#매장소식', '#오늘의메뉴', '#동네맛집'],
    },
    {
      id: `ig_test_${Date.now()}_2`,
      channel: 'instagram',
      title: `${sampleTopic} 특별 안내`,
      text: `오늘도 소중한 발걸음 감사드립니다. ${sampleTopic} 소식 전해드려요. [${phraseHighlight}]를 가득 담아 반갑게 맞이하겠습니다.`,
      recommendedHashtags: ['#소희마케팅', '#사장님화이팅', '#매장일상'],
    },
  ]

  const threadsCopies: GeneratedCopyItem[] = [
    {
      id: `th_test_${Date.now()}_1`,
      channel: 'threads',
      text: `${sampleTopic} 소식! [${phraseHighlight}] 준비 완료했습니다. 오늘 저녁 따뜻한 한 끼 어떠세요? 🌿`,
      recommendedHashtags: ['#스레드매장일상'],
    },
    {
      id: `th_test_${Date.now()}_2`,
      channel: 'threads',
      text: `오늘 매장 오픈했습니다. ${sampleTopic} 관련 궁금하신 점은 댓글로 언제든 편하게 물어보세요! 😊`,
      recommendedHashtags: [],
    },
  ]

  const updatedDraft: TextHarnessVersion = {
    ...draft,
    testRunsCount: draft.testRunsCount + 1,
  }

  return {
    updatedDraft,
    instagramCopies,
    threadsCopies,
    executedAt: new Date().toISOString(),
  }
}

/**
 * HF-14: Confirm Text Harness Version
 * Invariant: testRunsCount MUST be >= 1.
 */
export function confirmTextHarnessVersion(params: {
  draft: TextHarnessVersion
  userId: string
  priorActiveVersion?: TextHarnessVersion | null
}): {
  confirmedVersion: TextHarnessVersion
  supersededVersion?: TextHarnessVersion | null
} {
  const { draft, userId, priorActiveVersion } = params

  if (draft.testRunsCount < 1) {
    throw new Error(
      '최소 1회 이상 테스트 생성을 실행해야 텍스트 하네스 기준을 확정할 수 있습니다. (HF-15 Invariant)'
    )
  }

  const confirmedAt = new Date().toISOString()

  const confirmedVersion: TextHarnessVersion = {
    ...draft,
    status: 'ACTIVE_CONFIRMED',
    confirmedAt,
    confirmedByUserId: userId,
  }

  let supersededVersion: TextHarnessVersion | null = null
  if (priorActiveVersion && priorActiveVersion.status === 'ACTIVE_CONFIRMED') {
    supersededVersion = {
      ...priorActiveVersion,
      status: 'SUPERSEDED',
    }
  }

  return {
    confirmedVersion,
    supersededVersion,
  }
}

