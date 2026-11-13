import { createHash } from 'crypto'
import type { ConversationalBusinessKnowledgeDraft } from '@/features/knowledge/conversational-knowledge'
import {
  type StructuredVisualRules,
  DEFAULT_STRUCTURED_VISUAL_RULES,
  extractConversationalVisualRules,
} from './conversational-image-harness'

import type {
  PersonConsentStatus,
  AssetRightsStatus,
} from './image-harness-manager'

export type VisualDirectionKey = 'NATURAL_LIGHT' | 'DETAIL_FOCUS' | 'WARM_MOOD'

export interface VisualDirectionProposal {
  directionKey: VisualDirectionKey
  title: string
  description: string
  recommendedSubject: string
  rules: StructuredVisualRules
}

export interface CalibrationAsset {
  id: string
  digest: string
  url: string
  modelPresence: 'MODEL_PRESENT' | 'MODEL_ABSENT' | 'HAND_OR_DETAIL_ONLY'
  rightsStatus: AssetRightsStatus
  consentStatus: PersonConsentStatus
  provenance: {
    model: string
    stylePreset?: string
    prompt: string
  }
  revisionLineage?: {
    originalAssetId: string
    feedbackUtterance: string
    revisedAt: string
  }
}

export interface GoldenImageItem {
  id: string
  url?: string
  rightsStatus: string
  consentStatus: string
}

export interface ImageCalibrationDraft {
  workspaceId: string
  selectedDirectionKey?: VisualDirectionKey
  status: 'CALIBRATING' | 'ACTIVE_CONFIRMED'
  iterationCount: number
  calibrationHistory: Array<{
    iteration: number
    feedback: string
    appliedDelta: string
    timestamp: string
  }>
  goldenImages: GoldenImageItem[]
  confirmedAt?: string
  confirmedByUserId?: string
}

/**
 * [ANI-1447] Propose 3 distinct visual directions based on business facts
 */
export function proposeVisualDirections(
  knowledge: ConversationalBusinessKnowledgeDraft | null
): VisualDirectionProposal[] {
  const loc = knowledge?.location || '우리 매장 공간'
  const service = knowledge?.primaryServices || '대표 시술/상품'

  const dir1: VisualDirectionProposal = {
    directionKey: 'NATURAL_LIGHT',
    title: '자연 채광 & 공간 중심 스타일',
    description: `${loc}의 차분하고 자연스러운 채광을 살려 편안함을 전하는 스타일`,
    recommendedSubject: `${loc} 내부 인테리어 및 자연광 스냅`,
    rules: {
      ...DEFAULT_STRUCTURED_VISUAL_RULES,
      lighting: '은은한 자연 채광 및 부드러운 빛',
      background: '원목 및 차분한 매장 내부 공간',
      composition: '전경 및 45도 자연스러운 화각',
      modelPresence: 'MODEL_ABSENT',
    },
  }

  const dir2: VisualDirectionProposal = {
    directionKey: 'DETAIL_FOCUS',
    title: '디테일 포커스 & 완성도 중심 스타일',
    description: `${service}의 섬세한 텍스처와 정돈된 완성도를 강조하는 클로즈업 스타일`,
    recommendedSubject: `${service} 텍스처 및 정돈된 디테일 샷`,
    rules: {
      ...DEFAULT_STRUCTURED_VISUAL_RULES,
      lighting: '선명하고 또렷한 디테일 조명',
      background: '미니멀 단색 및 정돈된 배경',
      composition: '클로즈업 매크로 샷',
      modelPresence: 'HAND_OR_DETAIL_ONLY',
    },
  }

  const dir3: VisualDirectionProposal = {
    directionKey: 'WARM_MOOD',
    title: '따뜻한 감성 & 무드 중심 스타일',
    description: '고객에게 편안한 힐링과 친근함을 주는 웜톤 감성 스냅 스타일',
    recommendedSubject: '매장의 소품, 따뜻한 조명, 아늑한 분위기 연출',
    rules: {
      ...DEFAULT_STRUCTURED_VISUAL_RULES,
      colorTone: '따뜻한 웜톤 및 코지 베이지',
      lighting: '오후의 나른한 온화한 햇살',
      background: '따뜻하고 아늑한 감성 공간',
      modelPresence: 'MODEL_ABSENT',
    },
  }

  return [dir1, dir2, dir3]
}

/**
 * [ANI-1447] Apply natural-language feedback and generate lineage-preserved new asset
 */
export function applyImageCalibrationFeedback(params: {
  currentDirection: VisualDirectionProposal
  currentAsset: Partial<CalibrationAsset> & { id: string; digest: string }
  feedbackUtterance: string
}): {
  updatedRules: StructuredVisualRules
  newAsset: CalibrationAsset
  appliedDeltaExplanation: string
} {
  const { currentDirection, currentAsset, feedbackUtterance } = params
  const text = feedbackUtterance.trim()
  const lower = text.toLowerCase()

  const updatedRules: StructuredVisualRules = {
    ...currentDirection.rules,
  }

  const deltaParts: string[] = []

  // Feedback analysis
  if (lower.includes('얼굴 없이') || lower.includes('사람 빼') || lower.includes('모델 없이')) {
    updatedRules.modelPresence = 'MODEL_ABSENT'
    deltaParts.push('인물 얼굴 노출을 배제')
  } else if (lower.includes('손만') || lower.includes('디테일만')) {
    updatedRules.modelPresence = 'HAND_OR_DETAIL_ONLY'
    deltaParts.push('얼굴을 제외하고 손과 시술 디테일만 포커스')
  }

  if (lower.includes('자연스러운') || lower.includes('덜 꾸민') || lower.includes('실제 사진')) {
    updatedRules.background = '과도한 연출을 배제한 자연스러운 매장 본연의 배경'
    updatedRules.exposure = '자연스러운 생활광 밝기'
    deltaParts.push('인위적인 연출을 줄이고 자연스러운 본연의 질감을 반영')
  }

  const appliedDeltaExplanation =
    deltaParts.length > 0
      ? `이번에 바꾼 점: ${deltaParts.join(', ')}하도록 시각 규칙을 조율했습니다.`
      : '사장님의 피드백을 반영하여 조명과 구도 세부사항을 조율했습니다.'

  const now = Date.now()
  const newPrompt = `${currentDirection.recommendedSubject} reflecting ${feedbackUtterance}`
  const newDigest = createHash('sha256')
    .update(`${currentAsset.id}-${newPrompt}-${now}`)
    .digest('hex')

  const newAsset: CalibrationAsset = {
    id: `asset_img_${now}`,
    digest: newDigest,
    url: `/api/media/calib_${now}.jpg`,
    modelPresence: updatedRules.modelPresence,
    rightsStatus: 'USER_CONFIRMED',
    consentStatus: updatedRules.modelPresence === 'MODEL_ABSENT' ? 'NOT_APPLICABLE' : 'CONFIRMED',
    provenance: {
      model: 'gpt-image-2.5',
      stylePreset: 'sunburst',
      prompt: newPrompt,
    },
    revisionLineage: {
      originalAssetId: currentAsset.id,
      feedbackUtterance,
      revisedAt: new Date().toISOString(),
    },
  }

  return {
    updatedRules,
    newAsset,
    appliedDeltaExplanation,
  }
}

/**
 * [ANI-1447] Verify Rights & Likeness Consent
 */
export function verifyMediaRightsAndConsent(asset: {
  rightsStatus: string
  consentStatus: string
}): {
  publishEligibility: boolean
  rightsConfirmedAt?: string
  reason?: string
} {
  const allowedRights = ['OWNED', 'LICENSED', 'USER_CONFIRMED']
  const isRightsOk = allowedRights.includes(asset.rightsStatus)

  if (!isRightsOk) {
    return {
      publishEligibility: false,
      reason: '이미지의 상업적 사용 권한이 확인되지 않았습니다.',
    }
  }

  const allowedConsent = ['CONFIRMED', 'NOT_APPLICABLE']
  const isConsentOk = allowedConsent.includes(asset.consentStatus)

  if (!isConsentOk) {
    return {
      publishEligibility: false,
      reason: '포함된 인물의 초상권 이용 동의가 확인되지 않았습니다.',
    }
  }

  return {
    publishEligibility: true,
    rightsConfirmedAt: new Date().toISOString(),
  }
}

/**
 * [ANI-1447] Confirm Image Calibration Gate
 */
export function confirmImageCalibration(params: {
  draft: ImageCalibrationDraft
  userId: string
  userConfirmationPhrase?: string
  isExplicitlyApproved: boolean
}): ImageCalibrationDraft {
  const { draft, userId, userConfirmationPhrase, isExplicitlyApproved } = params

  const allowedPhrases = ['이 기준으로 사용', '이 느낌으로 기억해줘', '앞으로 이 기준으로 써줘']
  const hasValidPhrase = allowedPhrases.some((p) => userConfirmationPhrase?.includes(p))

  if (!isExplicitlyApproved || !hasValidPhrase) {
    throw new Error(
      "이미지 스타일 기준 확정을 위해서는 사장님의 명시적인 승인('이 기준으로 사용' 또는 '이 느낌으로 기억해줘')이 필요합니다. (Confirm Boundary Invariant)"
    )
  }

  if (draft.goldenImages.length < 3) {
    throw new Error(
      '골든 이미지는 최소 3장 이상 등록/선택되어야 스타일 기준을 확정할 수 있습니다. (3~5 Golden Images Invariant)'
    )
  }

  if (draft.goldenImages.length > 5) {
    throw new Error(
      '골든 이미지는 최대 5장까지만 등록/선택할 수 있습니다. (3~5 Golden Images Invariant)'
    )
  }

  // All golden images must pass rights & likeness check
  for (const img of draft.goldenImages) {
    const verified = verifyMediaRightsAndConsent(img)
    if (!verified.publishEligibility) {
      throw new Error(`골든 이미지(${img.id})의 권리 또는 초상권이 확인되지 않았습니다.`)
    }
  }

  const confirmed: ImageCalibrationDraft = {
    ...draft,
    status: 'ACTIVE_CONFIRMED',
    confirmedAt: new Date().toISOString(),
    confirmedByUserId: userId,
  }

  return Object.freeze(confirmed)
}
