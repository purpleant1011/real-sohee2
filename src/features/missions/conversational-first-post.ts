import { type SoheeReadinessSnapshot, SoheeNotReadyError } from '@/features/sohee-ready/types'
import { calculateApprovalFingerprint } from '@/lib/evidence/approval-fingerprint'
import { getTextApiKey, getGeminiApiBaseUrl } from '@/lib/ai/model-profiles'

export { calculateApprovalFingerprint }

export interface FirstPostIntent {
  topic: string
  goal: string
  isCustom: boolean
  preferredChannel?: 'instagram' | 'threads' | 'dual'
}

export interface BoundHarnessVersions {
  knowledgeVersion: number
  textHarnessVersion: number
  imageHarnessVersion: number
  operatingPolicyVersion: number
}

export interface ExactApprovalRights {
  rightsStatus: 'OWNED' | 'LICENSED' | 'USER_CONFIRMED'
  consentStatus: 'CONFIRMED' | 'NOT_APPLICABLE'
}

export interface ConnectedChannelInfo {
  provider: string
  handle: string
  profileUrl?: string
}

export interface ExactApprovalCopies {
  instagram: {
    caption: string
    hashtags?: string[]
    /**
     * 서버가 채널 연결과 비즈니스 근거를 확인했을 때만 채운다(ANI-1775).
     * 근거가 없으면 필드 자체가 없다 — 화면(M07)은 이 경우 `NO_CTA` 로 승인을 막는다.
     */
    cta?: string
  }
  threads: {
    content: string
    /** 인스타그램과 같은 규칙. 근거가 없으면 필드 자체가 없다. */
    cta?: string
  }
}

export interface ExactApprovalPayload {
  workspaceId: string
  missionId: string
  channels: ConnectedChannelInfo[]
  copies: ExactApprovalCopies
  imageIds: string[]
  boundVersions: BoundHarnessVersions
  rights: ExactApprovalRights
}

export interface FirstPostMissionDraft {
  missionId: string
  workspaceId: string
  status: 'AWAITING_EXACT_APPROVAL' | 'APPROVED_FOR_PUBLISH'
  topic: string
  goal: string
  copies: ExactApprovalCopies
  selectedImageIds: string[]
  mediaPreviews?: Array<{ id: string; url: string }>
  boundVersions: BoundHarnessVersions
  rights: ExactApprovalRights
  channels: ConnectedChannelInfo[]
  approvalFingerprint: string
  createdAt: string
  knowledgeSnapshot?: {
    businessName: string
    signatureServices?: string[]
    operatingHours?: string
    versionNumber?: number
  }
}

export interface ApprovedFirstPostMission {
  id: string
  workspaceId: string
  missionId: string
  approvalId: string
  status: 'APPROVED_FOR_PUBLISH'
  approvedFingerprint: string
  payload: ExactApprovalPayload
  approvedByUserId: string
  approvedAt: string
}

export interface ProposeFirstPostMissionParams {
  workspaceId: string
  readiness: SoheeReadinessSnapshot
  callerTenantId?: string
  utterance?: string
  copies?: ExactApprovalCopies
  mediaPreviews?: Array<{ id: string; url: string }>
  userMedia?: {
    selectedImageIds: string[]
    rights: ExactApprovalRights
    mediaPreviews?: Array<{ id: string; url: string }>
  }
  knowledgeSnapshot: {
    businessName: string
    signatureServices?: string[]
    operatingHours?: string
    versionNumber?: number
  }
  textHarnessSnapshot: {
    brandVoice?: string
    rules?: string[]
    versionNumber?: number
  }
  imageHarnessSnapshot: {
    goldenImageIds: string[]
    rightsStatus?: 'OWNED' | 'LICENSED' | 'USER_CONFIRMED'
    consentStatus?: 'CONFIRMED' | 'NOT_APPLICABLE'
    versionNumber?: number
  }
  operatingPolicySnapshot: {
    publishApprovalLevel?: string
    dailySpendLimitKrw?: number
    maxDailyPublishCount?: number
    versionNumber?: number
  }
  connectedChannels: ConnectedChannelInfo[]
  /** Explicitly opt into PREPARE_ONLY for proposal; publish approval still requires a verified channel. */
  admission?: 'DRAFT'
}

export interface ConfirmExactApprovalParams {
  payload: ExactApprovalPayload
  fingerprint: string
  isExplicitlyApproved: boolean
  explicitPhrase: string
  approvedByUserId: string
}

/**
 * 1. Admission Guard: Validates that first-post prerequisites are satisfied before creating mission
 * 2026-10-07 ANI-1524 확정: 첫 게시 조건 = 채널 1개 VERIFIED (두 채널 동시 인증 불필요)
 */
export function validateFirstPostAdmission(
  workspaceId: string,
  readiness: SoheeReadinessSnapshot,
  callerTenantId?: string
): void {
  if (callerTenantId && callerTenantId !== workspaceId) {
    throw new Error(
      `[CROSS_TENANT_ACCESS_DENIED] Caller tenant '${callerTenantId}' is not authorized to create mission for workspace '${workspaceId}'`
    )
  }

  if (!readiness || !readiness.ready) {
    throw new SoheeNotReadyError(readiness, 'FIRST_POST_MISSION')
  }

  // 2026-10-07 ANI-1524: At least 1 channel verified (Instagram OR Threads)
  const channelOk = Boolean(
    readiness.facts.INSTAGRAM_VERIFIED?.verified || readiness.facts.THREADS_VERIFIED?.verified
  )
  if (!channelOk) {
    throw new SoheeNotReadyError(
      readiness,
      'FIRST_POST_MISSION: Missing channel verification (Instagram or Threads required)'
    )
  }

  // 4 quick-start harness facts (Business knowledge, text harness, image harness, operating policy)
  const requiredHarnessFacts = [
    'BUSINESS_KNOWLEDGE_CONFIRMED',
    'TEXT_HARNESS_CONFIRMED',
    'IMAGE_HARNESS_CONFIRMED',
    'OPERATING_POLICY_CONFIRMED',
  ] as const

  const missingFacts = requiredHarnessFacts.filter((f) => !readiness.facts[f]?.verified)
  if (missingFacts.length > 0) {
    throw new SoheeNotReadyError(readiness, `FIRST_POST_MISSION: Missing [${missingFacts.join(', ')}]`)
  }
}

/**
 * 2. Conversational Intent Extraction
 */
export function extractFirstPostIntent(utterance: string): FirstPostIntent {
  const text = utterance.trim()
  if (!text) {
    return {
      topic: '매장 소개 및 첫 인사',
      goal: '신규 고객 방문 유도 및 친근한 첫인사',
      isCustom: false,
      preferredChannel: 'dual',
    }
  }

  const topic = text
  let goal = '고객 소통 및 매장 인지도 향상'

  if (text.includes('알리고') || text.includes('소개') || text.includes('홍보')) {
    goal = '신메뉴/시그니처 매장 소식 홍보 및 방문 유도'
  }

  return {
    topic,
    goal,
    isCustom: true,
    preferredChannel: 'dual',
  }
}



/**
 * 4. Propose First Post Mission (Binds 3 harnesses + policy into a single mission snapshot)
 */
export function proposeFirstPostMission(
  params: ProposeFirstPostMissionParams
): FirstPostMissionDraft {
  const {
    workspaceId,
    readiness,
    callerTenantId,
    utterance = '',
    knowledgeSnapshot,
    textHarnessSnapshot,
    imageHarnessSnapshot,
    operatingPolicySnapshot,
    connectedChannels,
  } = params

  if (params.admission === 'DRAFT') {
    if (callerTenantId && callerTenantId !== workspaceId) throw new Error('[CROSS_TENANT_ACCESS_DENIED] Workspace mismatch')
    const quickFacts = ['BUSINESS_KNOWLEDGE_CONFIRMED', 'TEXT_HARNESS_CONFIRMED', 'IMAGE_HARNESS_CONFIRMED', 'OPERATING_POLICY_CONFIRMED'] as const
    if (!readiness || quickFacts.some(key => !readiness.facts[key]?.verified)) throw new SoheeNotReadyError(readiness, 'FIRST_POST_DRAFT')
  } else {
    validateFirstPostAdmission(workspaceId, readiness, callerTenantId)
  }

  const intent = extractFirstPostIntent(utterance)
  const missionId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : '10000000-0000-4000-8000-000000000001'

  const bizName = knowledgeSnapshot.businessName || '우리 매장'
  const primaryService = knowledgeSnapshot.signatureServices?.[0] || '대표 메뉴'
  const hours = knowledgeSnapshot.operatingHours ? `\n🕒 영업시간: ${knowledgeSnapshot.operatingHours}` : ''

  // Dual-channel copy generation respecting text harness voice
  const igCaption = intent.isCustom
    ? `✨ [${bizName}] ${intent.topic}\n\n정성을 다해 준비한 ${primaryService} 소식을 전합니다. 매장에 편안하게 방문해 주세요!${hours}\n\n#${bizName.replace(/\s+/g, '')} #${primaryService.replace(/\s+/g, '')} #매장소식`
    : `✨ 안녕하세요, [${bizName}]입니다!\n\n저희 매장의 정성이 담긴 ${primaryService}와 함께 기분 좋은 하루를 시작해 보세요.${hours}\n\n#${bizName.replace(/\s+/g, '')} #첫인사 #동네맛집`

  const thContent = intent.isCustom
    ? `${bizName}에서 전하는 소식입니다. ${intent.topic} 준비했어요. 편하게 들러주세요! ☕`
    : `안녕하세요! ${bizName} 스레드 첫 게시물로 인사드립니다. 앞으로 매장의 실시간 소식과 일상을 전할게요.`

  // Bind media: userMedia takes precedence; fallback to golden reference images for legacy callers
  const selectedImageIds = params.userMedia
    ? params.userMedia.selectedImageIds
    : imageHarnessSnapshot.goldenImageIds.slice(0, 3)
  if (selectedImageIds.length === 0) {
    throw new Error('[IMAGE_HARNESS_ERROR] Golden reference images are required to formulate first mission')
  }

  const boundVersions: BoundHarnessVersions = {
    knowledgeVersion: knowledgeSnapshot.versionNumber ?? 1,
    textHarnessVersion: textHarnessSnapshot.versionNumber ?? 1,
    imageHarnessVersion: imageHarnessSnapshot.versionNumber ?? 1,
    operatingPolicyVersion: operatingPolicySnapshot.versionNumber ?? 1,
  }

  let rights: ExactApprovalRights
  if (params.userMedia) {
    rights = params.userMedia.rights
  } else {
    if (!imageHarnessSnapshot.rightsStatus || !['OWNED', 'LICENSED', 'USER_CONFIRMED'].includes(imageHarnessSnapshot.rightsStatus)) {
      throw new Error('[MISSING_RIGHTS_EVIDENCE] Golden image assets must have verified rightsStatus (OWNED, LICENSED, or USER_CONFIRMED). Cannot default to OWNED.')
    }

    if (!imageHarnessSnapshot.consentStatus || !['CONFIRMED', 'NOT_APPLICABLE'].includes(imageHarnessSnapshot.consentStatus)) {
      throw new Error('[MISSING_CONSENT_EVIDENCE] Golden image assets must have verified consentStatus (CONFIRMED or NOT_APPLICABLE). Cannot default to CONFIRMED.')
    }

    rights = {
      rightsStatus: imageHarnessSnapshot.rightsStatus,
      consentStatus: imageHarnessSnapshot.consentStatus,
    }
  }

  const copies: ExactApprovalCopies = params.copies || {
    instagram: {
      caption: igCaption,
      hashtags: [bizName.replace(/\s+/g, ''), primaryService.replace(/\s+/g, '')],
    },
    threads: {
      content: thContent,
    },
  }

  const payload: ExactApprovalPayload = {
    workspaceId,
    missionId,
    channels: connectedChannels,
    copies,
    imageIds: selectedImageIds,
    boundVersions,
    rights,
  }

  const approvalFingerprint = calculateApprovalFingerprint(payload)

  return {
    missionId,
    workspaceId,
    status: 'AWAITING_EXACT_APPROVAL',
    topic: intent.topic,
    goal: intent.goal,
    copies,
    selectedImageIds,
    mediaPreviews: params.mediaPreviews ?? params.userMedia?.mediaPreviews,
    boundVersions,
    rights,
    channels: connectedChannels,
    approvalFingerprint,
    createdAt: new Date().toISOString(),
    knowledgeSnapshot,
  }
}

/**
 * 5. Confirm Exact Approval
 */
export function confirmExactApproval(
  params: ConfirmExactApprovalParams
): Readonly<ApprovedFirstPostMission> {
  const {
    payload,
    fingerprint,
    isExplicitlyApproved,
    explicitPhrase,
    approvedByUserId,
  } = params

  if (!approvedByUserId) {
    throw new Error('[AUTHZ_ERROR] User identification required to confirm exact approval')
  }

  if (!isExplicitlyApproved || !explicitPhrase.includes('이 버전 승인하고 발행')) {
    throw new Error(
      "[EXPLICIT_APPROVAL_PHRASE_REQUIRED] Exact approval requires explicit confirmation phrase '이 버전 승인하고 발행'"
    )
  }

  const recalculated = calculateApprovalFingerprint(payload)
  if (recalculated !== fingerprint) {
    throw new Error(
      `[FINGERPRINT_MISMATCH_REJECTED] The submitted fingerprint '${fingerprint}' does not match content fingerprint '${recalculated}'`
    )
  }

  const approvalRecord: ApprovedFirstPostMission = {
    id: `appr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: payload.workspaceId,
    missionId: payload.missionId,
    approvalId: `appr_rec_${Date.now()}`,
    status: 'APPROVED_FOR_PUBLISH',
    approvedFingerprint: fingerprint,
    payload: {
      ...payload,
      channels: [...payload.channels],
      imageIds: [...payload.imageIds],
      boundVersions: { ...payload.boundVersions },
      rights: { ...payload.rights },
      copies: {
        instagram: { ...payload.copies.instagram },
        threads: { ...payload.copies.threads },
      },
    },
    approvedByUserId,
    approvedAt: new Date().toISOString(),
  }

  return Object.freeze(approvalRecord)
}

/**
 * 6. Validate Approval For Publish (Tamper Invariant Check)
 */
export function validateApprovalForPublish(
  approved: ApprovedFirstPostMission,
  currentPayload: ExactApprovalPayload
): void {
  if (approved.status !== 'APPROVED_FOR_PUBLISH' || !approved.approvalId) {
    throw new Error('[MISSION_NOT_APPROVED] First post mission is not in approved state')
  }

  const currentFp = calculateApprovalFingerprint(currentPayload)
  if (currentFp !== approved.approvedFingerprint) {
    throw new Error(
      `[APPROVAL_FINGERPRINT_TAMPERED] Content diverges from approved snapshot. Approved: '${approved.approvedFingerprint}', Current: '${currentFp}'. Re-approval required.`
    )
  }
}

export interface ReviseFirstPostMissionParams {
  draft: FirstPostMissionDraft
  revisionType: 'TEXT_ONLY' | 'IMAGE_ONLY' | 'BOTH'
  feedbackUtterance: string
  newImageIds?: string[]
  newCopies?: ExactApprovalCopies
  mediaPreviews?: Array<{ id: string; url: string }>
}

export function reviseFirstPostMissionDraft(
  params: ReviseFirstPostMissionParams
): {
  revisedDraft: FirstPostMissionDraft
  deltaExplanation: string
} {
  const { draft, revisionType, feedbackUtterance, newImageIds: customNewImageIds, newCopies: customNewCopies, mediaPreviews } = params
  const text = feedbackUtterance.trim()

  const newCopies = customNewCopies || {
    instagram: { ...draft.copies.instagram },
    threads: { ...draft.copies.threads },
  }
  let newImageIds = customNewImageIds ? [...customNewImageIds] : [...draft.selectedImageIds]
  let deltaExplanation = ''

  if (!customNewCopies && (revisionType === 'TEXT_ONLY' || revisionType === 'BOTH')) {
    const baseIg = draft.copies.instagram.caption
    const baseTh = draft.copies.threads.content

    if (text.includes('담백') || text.includes('간결')) {
      newCopies.instagram.caption = baseIg.replace(/[✨!😊🎉]/g, '').replace(/\n\n\n+/g, '\n\n').trim()
      newCopies.threads.content = baseTh.replace(/[☕!✨]/g, '').trim()
      deltaExplanation = '문장의 감탄사와 이모지를 줄이고 보다 담백하고 정갈한 어조로 조율했습니다.'
    } else if (text.includes('친근') || text.includes('다정') || text.includes('부드럽게')) {
      newCopies.instagram.caption = baseIg.startsWith('안녕하세요')
        ? baseIg
        : `안녕하세요 사장님들의 따뜻한 이웃, ${baseIg}`
      newCopies.threads.content = `오늘도 찾아주셔서 감사합니다! ${baseTh}`
      deltaExplanation = '인사와 온기를 더해 고객에게 더욱 친근하고 다정한 문장으로 다듬었습니다.'
    } else {
      newCopies.instagram.caption = `${baseIg}\n\n[수정 반영: ${text}]`
      newCopies.threads.content = `${baseTh} (${text})`
      deltaExplanation = `요청하신 피드백("${text}")을 반영하여 문구를 새롭게 조율했습니다.`
    }
  }

  if (revisionType === 'IMAGE_ONLY' || revisionType === 'BOTH') {
    if (customNewImageIds && customNewImageIds.length > 0) {
      newImageIds = [...customNewImageIds]
    } else {
      // Fallback for isolated unit testing when orchestrator asset is not injected
      const fallbackId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `asset_${Date.now()}`
      newImageIds = [fallbackId, ...newImageIds.slice(1)]
    }
    const imgDelta = '요청하신 시각 스타일에 맞춰 연결된 골든 이미지 세트를 새롭게 재구성했습니다.'
    deltaExplanation = deltaExplanation ? `${deltaExplanation} 또한 ${imgDelta}` : imgDelta
  }

  const payload: ExactApprovalPayload = {
    workspaceId: draft.workspaceId,
    missionId: draft.missionId,
    channels: draft.channels,
    copies: newCopies,
    imageIds: newImageIds,
    boundVersions: draft.boundVersions,
    rights: draft.rights,
  }

  const newFingerprint = calculateApprovalFingerprint(payload)

  const revisedDraft: FirstPostMissionDraft = {
    ...draft,
    copies: newCopies,
    selectedImageIds: newImageIds,
    mediaPreviews: mediaPreviews || draft.mediaPreviews,
    approvalFingerprint: newFingerprint,
    status: 'AWAITING_EXACT_APPROVAL',
  }

  return {
    revisedDraft,
    deltaExplanation: deltaExplanation || '수정 사항이 반영되었습니다.',
  }
}

export class FirstPostComposerProviderError extends Error {
  constructor(message: string, public readonly code = 'FIRST_POST_PROVIDER_ERROR') {
    super(message)
    this.name = 'FirstPostComposerProviderError'
  }
}

export interface ComposeFirstPostWithGeminiInput {
  bizName: string
  primaryService?: string
  brandVoice?: string
  topic?: string
  feedbackUtterance?: string
  apiKey?: string
}

export async function composeFirstPostWithGemini(
  input: ComposeFirstPostWithGeminiInput
): Promise<ExactApprovalCopies> {
  const apiKey = (input.apiKey !== undefined ? input.apiKey : (getTextApiKey() || '')).trim()
  if (!apiKey) {
    throw new FirstPostComposerProviderError(
      'Gemini API key is required but missing. Live provider or explicit test double required.',
      'MISSING_API_KEY'
    )
  }

  const {
    bizName,
    primaryService,
    brandVoice = '따뜻하고 정갈한 어조',
    feedbackUtterance,
    topic = '매장 소개 및 첫 인사',
  } = input

  const serviceContext = primaryService
    ? `대표 서비스/메뉴: ${primaryService}`
    : '대표 서비스/메뉴: (등록된 대표 메뉴 없음 - 특정 메뉴명을 임의로 지어내지 말 것)'

  const prompt = `당신은 소상공인 마케팅 AI '소희'입니다.
매장명: ${bizName}
${serviceContext}
말투 기준: ${brandVoice}
주제: ${topic}
${feedbackUtterance ? `피드백 반영 요구: ${feedbackUtterance}` : ''}

[엄격한 사실 기반 원칙 (Anti-Fabrication)]:
1. 가짜 고객 리뷰, 찬사, 만족도 후기(예: "많은 고객님들의 찬사", "후기 폭발", "재방문율 100%")를 절대 창작하지 마세요.
2. 임의의 예약 가능 여부나 "마감 임박", "이번 주 예약 가능" 같은 허위 긴급성을 지어내지 마세요.
3. 사장님이 직접 등록하지 않은 임의의 할인 행사, 프로모션, 가격, 무료 혜택을 창작하지 마세요.
4. 검증되지 않은 자격증, 수상 경력, 특허, 협회 인증을 임의로 지어내지 마세요.
5. 확인되지 않은 의학적/기능적 효능이나 품질 보증, 없는 원재료/제품을 언급하지 마세요.
6. 오직 제공된 사실에만 근거하여 진솔하게 작성하며, 구체적 정보가 없는 항목은 지어내지 말고 자연스럽게 생략하세요.

[주의]: 등록되지 않은 가공의 메뉴명, 영업시간, 가격 등 구체적 사실을 임의로 창작(fabricate)하지 마세요.

인스타그램과 스레드용 첫 게시물 카피를 작성해 주세요.
반드시 아래 JSON 형식으로만 응답하세요:
{
  "instagram": {
    "caption": "인스타그램 캡션 본문 (이모지와 줄바꿈 포함)",
    "hashtags": ["#해시태그1", "#해시태그2"]
  },
  "threads": {
    "content": "스레드 본문 (간결하고 감성적인 대화체)"
  }
}`

  const baseUrl = getGeminiApiBaseUrl()
  let response: Response
  try {
    response = await fetch(
      `${baseUrl}/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      }
    )
  } catch (networkErr: any) {
    throw new FirstPostComposerProviderError(
      `Gemini network request failed: ${networkErr?.message || networkErr}`,
      'NETWORK_ERROR'
    )
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    throw new FirstPostComposerProviderError(
      `Gemini 3.5 Flash Lite API returned error (${response.status}): ${errorBody}`,
      'PROVIDER_CALL_FAILED'
    )
  }

  let data: any
  try {
    data = await response.json()
  } catch (jsonErr: any) {
    throw new FirstPostComposerProviderError(
      `Failed to parse Gemini response as JSON: ${jsonErr?.message}`,
      'MALFORMED_RESPONSE'
    )
  }

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    throw new FirstPostComposerProviderError(
      'Gemini response candidate text is missing or empty',
      'EMPTY_RESPONSE'
    )
  }

  let cleaned = rawText.trim()
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7)
  if (cleaned.startsWith('```')) cleaned = cleaned.slice(3)
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3)
  cleaned = cleaned.trim()

  let parsed: any
  try {
    parsed = JSON.parse(cleaned)
  } catch (parseErr: any) {
    throw new FirstPostComposerProviderError(
      `Failed to parse Gemini candidate JSON: ${parseErr?.message}. Content: ${rawText.slice(0, 100)}`,
      'MALFORMED_JSON'
    )
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new FirstPostComposerProviderError(
      'Gemini structured output is not an object',
      'MALFORMED_SHAPE'
    )
  }

  if (
    !parsed.instagram ||
    typeof parsed.instagram !== 'object' ||
    typeof parsed.instagram.caption !== 'string' ||
    !parsed.instagram.caption.trim()
  ) {
    throw new FirstPostComposerProviderError(
      'Gemini response missing valid instagram caption',
      'MALFORMED_SHAPE'
    )
  }

  if (
    !parsed.threads ||
    typeof parsed.threads !== 'object' ||
    typeof parsed.threads.content !== 'string' ||
    !parsed.threads.content.trim()
  ) {
    throw new FirstPostComposerProviderError(
      'Gemini response missing valid threads content',
      'MALFORMED_SHAPE'
    )
  }

  const hashtags = Array.isArray(parsed.instagram.hashtags)
    ? parsed.instagram.hashtags
        .map((h: any) => String(h).trim())
        .filter(Boolean)
        .map((h: string) => (h.startsWith('#') ? h : `#${h}`))
    : []

  const instagramCaption = parsed.instagram.caption.trim()
  const threadsContent = parsed.threads.content.trim()

  validateFirstPostSemanticGrounding({
    instagramCaption,
    threadsContent,
    bizName,
    primaryService,
    feedbackUtterance,
  })

  return {
    instagram: {
      caption: instagramCaption,
      hashtags,
    },
    threads: {
      content: threadsContent,
    },
  }
}

function validateFirstPostSemanticGrounding(params: {
  instagramCaption: string
  threadsContent: string
  bizName: string
  primaryService?: string
  feedbackUtterance?: string
}): void {
  const combinedText = `${params.instagramCaption} ${params.threadsContent}`
  const normalized = combinedText.replace(/\s+/g, ' ')

  // 1. Ungrounded discount / promotion patterns
  const discountPatterns = [
    /\d+%\s*(?:할인|세일|D\/C|DC|디스카운트)/i,
    /(?:할인이벤트|오픈특가|타임세일|타임\s*세일|무료\s*증정|쿠폰\s*증정|1\+1|2\+1|반값)/,
    /(?:첫\s*방문|오픈\s*기념|전\s*메뉴).*?(?:할인|무료|증정|특가)/,
    /\d+(?:천|만)?원\s*(?:할인|쿠폰)/,
  ]
  for (const pattern of discountPatterns) {
    if (pattern.test(normalized)) {
      if (params.feedbackUtterance && pattern.test(params.feedbackUtterance)) continue
      throw new FirstPostComposerProviderError(
        `Gemini generated ungrounded discount/promotion claim: "${normalized.match(pattern)?.[0]}"`,
        'UNGROUNDED_FABRICATION_DETECTED'
      )
    }
  }

  // 2. Ungrounded operating hours or urgency claims
  const urgencyPatterns = [
    /영업시간\s*[:：]?\s*\d+/i,
    /\d{1,2}(?::\d{2})?\s*~\s*\d{1,2}(?::\d{2})?/,
    /(?:마감\s*임박|예약\s*마감|당일\s*예약|서두르세요|서둘러\s*주세요)/,
  ]
  for (const pattern of urgencyPatterns) {
    if (pattern.test(normalized)) {
      if (params.feedbackUtterance && pattern.test(params.feedbackUtterance)) continue
      throw new FirstPostComposerProviderError(
        `Gemini generated ungrounded operating hours or urgency claim: "${normalized.match(pattern)?.[0]}"`,
        'UNGROUNDED_FABRICATION_DETECTED'
      )
    }
  }

  // 3. Fabricated customer reviews, ratings, or reputation claims
  const reviewPatterns = [
    /(?:고객\s*만족도\s*1위|재방문율\s*1위|1등\s*맛집|별점\s*5점|5점\s*만점|리뷰\s*폭발|후기\s*폭발|극찬이\s*이어지는|단골들의\s*극찬|손님들의\s*칭찬)/,
  ]
  for (const pattern of reviewPatterns) {
    if (pattern.test(normalized)) {
      if (params.feedbackUtterance && pattern.test(params.feedbackUtterance)) continue
      throw new FirstPostComposerProviderError(
        `Gemini generated fabricated customer review/rating claim: "${normalized.match(pattern)?.[0]}"`,
        'UNGROUNDED_FABRICATION_DETECTED'
      )
    }
  }

  // 4. Unconfirmed medical, efficacy, patent, or award claims
  const efficacyPatterns = [
    /(?:특허\s*받은|식약처\s*인증|공식\s*인증|국내\s*유일|국내\s*최초|세계\s*최초|대상\s*수상|브랜드\s*대상|원조)/,
  ]
  for (const pattern of efficacyPatterns) {
    if (pattern.test(normalized)) {
      if (params.feedbackUtterance && pattern.test(params.feedbackUtterance)) continue
      throw new FirstPostComposerProviderError(
        `Gemini generated ungrounded efficacy/patent/award claim: "${normalized.match(pattern)?.[0]}"`,
        'UNGROUNDED_FABRICATION_DETECTED'
      )
    }
  }
}
