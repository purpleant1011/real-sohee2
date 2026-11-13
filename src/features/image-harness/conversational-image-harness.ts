import { createHash } from 'crypto'
import type { ReferenceImageCategory, AssetRightsStatus, PersonConsentStatus } from './image-harness-manager'

export interface StructuredVisualRules {
  modelPresence: 'MODEL_PRESENT' | 'MODEL_ABSENT' | 'HAND_OR_DETAIL_ONLY'
  location: string
  composition: string
  lighting: string
  colorTone: string
  background: string
  exposure: string
  forbiddenElements: readonly string[]
  channelRatio: 'SQUARE_1_1' | 'PORTRAIT_4_5' | 'DUAL_RATIO'
}

export const DEFAULT_STRUCTURED_VISUAL_RULES: StructuredVisualRules = {
  modelPresence: 'MODEL_ABSENT',
  location: '매장 내부 주요 공간',
  composition: '정면 및 45도 클로즈업',
  lighting: '은은한 자연 채광',
  colorTone: '따뜻한 웜톤 및 베이지',
  background: '원목 및 정돈된 매장 인테리어',
  exposure: '자연스럽고 화사한 밝기',
  forbiddenElements: ['과도한 AI 왜곡', '네온사인 조명', '타사 상표 노출', '인위적 워터마크'],
  channelRatio: 'SQUARE_1_1',
}

export function extractConversationalVisualRules(
  utterance: string,
  existingRules: Partial<StructuredVisualRules> = {}
): StructuredVisualRules {
  const text = utterance.trim()
  const lower = text.toLowerCase()
  const rules: StructuredVisualRules = {
    ...DEFAULT_STRUCTURED_VISUAL_RULES,
    ...existingRules,
  }

  // 1. Model Presence
  if (
    lower.includes('손') ||
    lower.includes('시술 디테일') ||
    lower.includes('디테일 위주') ||
    lower.includes('얼굴이 직접 나오지 않고') ||
    lower.includes('얼굴 없이')
  ) {
    rules.modelPresence = 'HAND_OR_DETAIL_ONLY'
  } else if (lower.includes('모델') || lower.includes('사람') || lower.includes('인물')) {
    rules.modelPresence = 'MODEL_PRESENT'
  } else {
    rules.modelPresence = 'MODEL_ABSENT'
  }

  // 2. Location
  if (lower.includes('매장 내부')) {
    rules.location = '매장 내부'
  } else if (lower.includes('매장 외부') || lower.includes('외관')) {
    rules.location = '매장 외부'
  } else if (lower.includes('호수공원')) {
    rules.location = '호수공원 및 야외'
  }

  // 3. Background
  if (lower.includes('원목')) {
    rules.background = '원목 인테리어 및 자연스러운 매장 배경'
  } else if (lower.includes('단색') || lower.includes('미니멀')) {
    rules.background = '미니멀 단색 배경'
  }

  // 4. Composition
  if (lower.includes('45도')) {
    rules.composition = '상단 45도 각도 및 디테일 포커스'
  } else if (lower.includes('클로즈업')) {
    rules.composition = '매크로 클로즈업 샷'
  } else if (lower.includes('전경')) {
    rules.composition = '전경 와이드 샷'
  }

  // 5. Channel Ratio
  if (
    lower.includes('둘 다') ||
    (lower.includes('1:1') && lower.includes('4:5')) ||
    (lower.includes('정사각') && lower.includes('세로'))
  ) {
    rules.channelRatio = 'DUAL_RATIO'
  } else if (lower.includes('4:5') || lower.includes('세로')) {
    rules.channelRatio = 'PORTRAIT_4_5'
  } else {
    rules.channelRatio = 'SQUARE_1_1'
  }

  // 6. Lighting
  if (lower.includes('자연광') || lower.includes('채광')) {
    rules.lighting = '은은한 자연광 및 부드러운 채광'
  } else if (lower.includes('스튜디오') || lower.includes('조명')) {
    rules.lighting = '선명한 스튜디오 앰비언트 라이트'
  }

  // 7. Color Tone
  if (lower.includes('웜톤') || lower.includes('따뜻')) {
    rules.colorTone = '따뜻한 웜톤 및 골든 베이지'
  } else if (lower.includes('쿨톤') || lower.includes('차분한')) {
    rules.colorTone = '차분하고 모던한 쿨톤'
  }

  // 8. Exposure
  if (lower.includes('화사') || lower.includes('밝게')) {
    rules.exposure = '자연스럽고 화사한 노출'
  } else if (lower.includes('차분한 노출') || lower.includes('어둡')) {
    rules.exposure = '차분하고 깊이 있는 노출'
  }

  // 9. Forbidden Elements
  const forbidden: string[] = [...rules.forbiddenElements]
  if (lower.includes('타사 상표')) forbidden.push('타사 상표')
  if (lower.includes('워터마크')) forbidden.push('워터마크')
  if (lower.includes('네온사인')) forbidden.push('네온사인')
  if (lower.includes('ai 왜곡')) forbidden.push('AI 왜곡')
  if (lower.includes('과도한 필터')) forbidden.push('과도한 필터')

  rules.forbiddenElements = Array.from(new Set(forbidden))

  return rules
}

export interface ConversationalImageReferenceAsset {
  id: string
  url: string
  category: ReferenceImageCategory
  caption?: string
  positivePoints?: string[]
  negativePoints?: string[]
  rightsStatus: AssetRightsStatus
  consentStatus: PersonConsentStatus
  rightsConfirmedAt?: string
}

export interface TestVariationItem {
  id: string
  harnessVersionId: string
  variantLabel: 'A' | 'B' | 'C' | 'D'
  title: string
  prompt: string
  imageUrl: string
}

export interface UserFeedbackEvidence {
  variationId: string
  feedback: 'THUMBS_UP' | 'THUMBS_DOWN'
  note?: string
  recordedAt: string
}

export interface ConversationalImageHarnessState {
  id: string
  workspaceId: string
  lifecycleStatus: 'DRAFT' | 'TESTING' | 'GOLDEN_SELECTED' | 'CONFIRMED'
  referenceAssets: ConversationalImageReferenceAsset[]
  goldenImageIds: string[]
  visualRules: StructuredVisualRules
  testRunsCount: number
  testBatch: TestVariationItem[]
  userFeedbackEvidence: UserFeedbackEvidence[]
}

export function createConversationalImageHarness(params: {
  workspaceId: string
  referenceAssets?: ConversationalImageReferenceAsset[]
  visualRules?: StructuredVisualRules
}): ConversationalImageHarnessState {
  return {
    id: `cih_${Date.now()}`,
    workspaceId: params.workspaceId,
    lifecycleStatus: 'DRAFT',
    referenceAssets: params.referenceAssets ? [...params.referenceAssets] : [],
    goldenImageIds: [],
    visualRules: params.visualRules || { ...DEFAULT_STRUCTURED_VISUAL_RULES },
    testRunsCount: 0,
    testBatch: [],
    userFeedbackEvidence: [],
  }
}

export function transitionToTesting(
  harness: ConversationalImageHarnessState
): ConversationalImageHarnessState {
  const newRunsCount = harness.testRunsCount + 1
  const testBatch: TestVariationItem[] = [
    {
      id: `test_var_${Date.now()}_A`,
      harnessVersionId: harness.id,
      variantLabel: 'A',
      title: '자연광 매장 연출 시안 (A안)',
      prompt: `Warm golden lighting, natural light, artisan interior, composition: ${harness.visualRules.composition}. Model: ${harness.visualRules.modelPresence}`,
      imageUrl: 'https://cdn.example.com/samples/variation_A.jpg',
    },
    {
      id: `test_var_${Date.now()}_B`,
      harnessVersionId: harness.id,
      variantLabel: 'B',
      title: '시그니처 디테일 포커스 시안 (B안)',
      prompt: `Close up shot of handcrafted texture, warm tones, natural lighting, background: ${harness.visualRules.background}`,
      imageUrl: 'https://cdn.example.com/samples/variation_B.jpg',
    },
  ]

  return {
    ...harness,
    lifecycleStatus: 'TESTING',
    testRunsCount: newRunsCount,
    testBatch,
  }
}

export function recordTestFeedback(
  harness: ConversationalImageHarnessState,
  variationId: string,
  feedback: 'THUMBS_UP' | 'THUMBS_DOWN',
  note?: string
): ConversationalImageHarnessState {
  const evidence: UserFeedbackEvidence = {
    variationId,
    feedback,
    note,
    recordedAt: new Date().toISOString(),
  }

  return {
    ...harness,
    userFeedbackEvidence: [...harness.userFeedbackEvidence, evidence],
  }
}

export function selectGoldenImages(
  harness: ConversationalImageHarnessState,
  goldenIds: string[]
): ConversationalImageHarnessState {
  if (goldenIds.length < 3) {
    throw new Error(
      `INSUFFICIENT_GOLDEN_IMAGES: 골든 레퍼런스 이미지는 최소 3장 이상 선택해야 합니다. (선택: ${goldenIds.length}장)`
    )
  }

  if (goldenIds.length > 5) {
    throw new Error(
      `EXCESS_GOLDEN_IMAGES: 골든 레퍼런스 이미지는 최대 5장까지만 선택할 수 있습니다. (선택: ${goldenIds.length}장)`
    )
  }

  return {
    ...harness,
    lifecycleStatus: 'GOLDEN_SELECTED',
    goldenImageIds: [...goldenIds],
  }
}

export interface ConfirmConversationalHarnessParams {
  harness: ConversationalImageHarnessState
  userId: string
  explicitApprovalPhrase?: string
  isExplicitlyApproved: boolean
}

export interface ImmutableImageHarnessSnapshot {
  id: string
  workspaceId: string
  versionNumber: number
  status: 'ACTIVE_CONFIRMED'
  isImmutable: true
  rules: StructuredVisualRules
  goldenImageIds: readonly string[]
  referenceAssetsCount: number
  testRunsCount: number
  confirmedAt: string
  confirmedByUserId: string
  immutableHash: string
}

export function confirmConversationalImageHarness(
  params: ConfirmConversationalHarnessParams
): ImmutableImageHarnessSnapshot {
  const { harness, userId, explicitApprovalPhrase, isExplicitlyApproved } = params

  // Invariant 1: Confirm boundary explicit check
  const hasPhrase = explicitApprovalPhrase?.includes('이 기준으로 사용')
  if (!isExplicitlyApproved || !hasPhrase) {
    throw new Error(
      "EXPLICIT_CONFIRMATION_REQUIRED: 이미지 하네스 확정을 위해서는 사용자의 명시적인 '이 기준으로 사용' 확인이 필요합니다."
    )
  }

  // Invariant 2: Minimum 1 test run
  if (harness.testRunsCount < 1) {
    throw new Error('TEST_RUN_REQUIRED: 최소 1회 이상의 스타일 변형 테스트 생성을 검토해야 합니다.')
  }

  // Invariant 3: Golden Count (3 <= N <= 5)
  if (harness.goldenImageIds.length < 3) {
    throw new Error(
      `INSUFFICIENT_GOLDEN_IMAGES: 최소 3장 이상의 골든 이미지가 필요합니다. (현재: ${harness.goldenImageIds.length}장)`
    )
  }
  if (harness.goldenImageIds.length > 5) {
    throw new Error(
      `EXCESS_GOLDEN_IMAGES: 최대 5장까지만 골든 이미지로 지정할 수 있습니다. (현재: ${harness.goldenImageIds.length}장)`
    )
  }

  // Invariant 4: Rights & Consent on selected golden assets
  for (const goldenId of harness.goldenImageIds) {
    const asset = harness.referenceAssets.find((a) => a.id === goldenId)
    if (!asset) {
      throw new Error(
        `GOLDEN_ASSET_NOT_FOUND: 골든 이미지(${goldenId})를 등록된 레퍼런스 자산 목록에서 찾을 수 없습니다.`
      )
    }

    const rightsAllowed: AssetRightsStatus[] = ['OWNED', 'LICENSED', 'USER_CONFIRMED']
    if (!rightsAllowed.includes(asset.rightsStatus) || !asset.rightsConfirmedAt) {
      throw new Error(
        `RIGHTS_UNCONFIRMED: 골든 이미지(${goldenId})의 사장님 저작권 확인(OWNED/LICENSED/USER_CONFIRMED)이 완료되지 않았습니다.`
      )
    }

    if (asset.consentStatus === 'REQUIRED_MISSING' || asset.consentStatus === 'UNKNOWN') {
      throw new Error(
        `CONSENT_MISSING: 골든 이미지(${goldenId})의 초상권 확인(CONFIRMED 또는 NOT_APPLICABLE)이 필요합니다.`
      )
    }
  }

  const now = new Date().toISOString()
  const goldenIdsCopy = Object.freeze([...harness.goldenImageIds])
  const rulesCopy = Object.freeze({
    ...harness.visualRules,
    forbiddenElements: Object.freeze([...harness.visualRules.forbiddenElements]),
  })

  // Compute immutable hash
  const hashPayload = JSON.stringify({
    workspaceId: harness.workspaceId,
    goldenImageIds: goldenIdsCopy,
    rules: rulesCopy,
    confirmedAt: now,
    confirmedByUserId: userId,
  })
  const immutableHash = createHash('sha256').update(hashPayload).digest('hex')

  const snapshot: ImmutableImageHarnessSnapshot = {
    id: `ih_snapshot_${Date.now()}`,
    workspaceId: harness.workspaceId,
    versionNumber: 1,
    status: 'ACTIVE_CONFIRMED',
    isImmutable: true,
    rules: rulesCopy,
    goldenImageIds: goldenIdsCopy,
    referenceAssetsCount: harness.referenceAssets.length,
    testRunsCount: harness.testRunsCount,
    confirmedAt: now,
    confirmedByUserId: userId,
    immutableHash,
  }

  return Object.freeze(snapshot)
}

export interface MediaHarnessLineageRecord {
  mediaAssetId: string
  workspaceId: string
  imageHarnessVersionId: string
  goldenAssetIds: readonly string[]
  rightsStatus: AssetRightsStatus
  consentStatus: PersonConsentStatus
  promptFingerprint: string
  provider: string
  immutableHash: string
  createdAt: string
}

export function createMediaHarnessLineage(params: {
  mediaAssetId: string
  harnessSnapshot: ImmutableImageHarnessSnapshot
  prompt: string
  provider?: string
}): MediaHarnessLineageRecord {
  const { mediaAssetId, harnessSnapshot, prompt, provider = 'sohee-image-generator' } = params

  const promptFingerprint = createHash('sha256').update(prompt.trim().toLowerCase()).digest('hex')
  const lineageHash = createHash('sha256')
    .update(`${mediaAssetId}:${harnessSnapshot.id}:${harnessSnapshot.immutableHash}:${promptFingerprint}`)
    .digest('hex')

  return Object.freeze({
    mediaAssetId,
    workspaceId: harnessSnapshot.workspaceId,
    imageHarnessVersionId: harnessSnapshot.id,
    goldenAssetIds: harnessSnapshot.goldenImageIds,
    rightsStatus: 'OWNED',
    consentStatus: 'NOT_APPLICABLE',
    promptFingerprint,
    provider,
    immutableHash: lineageHash,
    createdAt: new Date().toISOString(),
  })
}
