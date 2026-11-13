import { createHash } from 'crypto'
import {
  type OperatingPolicyRules,
} from './types'
import {
  DEFAULT_OPERATING_POLICY_RULES,
  validateOperatingPolicyRules,
} from './operating-policy-manager'
import {
  translateInternalErrorToHuman,
  type HumanTranslatedError,
} from '@/features/onboarding/conversation/human-error-translator'

export interface ProgressivePolicyRestrictions {
  noExaggeration: boolean
  priceInquiryDmOnly: boolean
  noStaffFace: boolean
  prohibitedWords: readonly string[]
  customRestrictions: readonly string[]
  appliedSummary: readonly string[]
}

export const DEFAULT_PROGRESSIVE_RESTRICTIONS: ProgressivePolicyRestrictions = Object.freeze({
  noExaggeration: false,
  priceInquiryDmOnly: false,
  noStaffFace: false,
  prohibitedWords: Object.freeze([] as string[]),
  customRestrictions: Object.freeze([] as string[]),
  appliedSummary: Object.freeze([] as string[]),
})

export function extractPolicyRestrictions(
  utterance: string,
  existing: Partial<ProgressivePolicyRestrictions> = {}
): ProgressivePolicyRestrictions {
  const text = utterance.trim()
  const lower = text.toLowerCase()

  let noExaggeration = existing.noExaggeration ?? false
  let priceInquiryDmOnly = existing.priceInquiryDmOnly ?? false
  let noStaffFace = existing.noStaffFace ?? false
  const prohibitedWords = new Set<string>(existing.prohibitedWords ?? [])
  const customRestrictions = new Set<string>(existing.customRestrictions ?? [])
  const appliedSummary = new Set<string>(existing.appliedSummary ?? [])

  if (
    lower.includes('과장') ||
    lower.includes('허위') ||
    lower.includes('사실만') ||
    lower.includes('효과 표현 금지') ||
    lower.includes('최고라는 말')
  ) {
    noExaggeration = true
    appliedSummary.add('과장 광고 및 허위 표현 금지')
  }

  if (
    lower.includes('가격') &&
    (lower.includes('dm') ||
      lower.includes('문의') ||
      lower.includes('공개하지') ||
      lower.includes('적지') ||
      lower.includes('비공개'))
  ) {
    priceInquiryDmOnly = true
    appliedSummary.add('가격 비공개 (DM 문의 유도)')
  }

  if (
    lower.includes('얼굴') ||
    lower.includes('인물') ||
    lower.includes('직원')
  ) {
    noStaffFace = true
    appliedSummary.add('직원/인물 얼굴 노출 보호')
  }

  // Extract explicit prohibited words or patterns
  if (lower.includes('최저가')) {
    prohibitedWords.add('최저가')
  }
  if (lower.includes('1등') || lower.includes('1위')) {
    prohibitedWords.add('1등')
  }
  if (lower.includes('비속어') || lower.includes('비방')) {
    prohibitedWords.add('비속어/비방')
    appliedSummary.add('비속어 및 비방 표현 금지')
  }

  const customMatches = text.match(/([가-힣a-zA-Z0-9,\s]+)(?:는|은)\s*(?:절대\s*)?(?:쓰지|사용하지|피해|금지)/)
  if (customMatches && customMatches[1]) {
    const words = customMatches[1].split(/[,/ ]+/).map(w => w.trim()).filter(w => w.length > 0 && !['절대', '쓰지', '금지', '단어', '말은', '과장된', '표현이나', '최고라는'].includes(w))
    words.forEach(w => prohibitedWords.add(w))
  }

  if (prohibitedWords.size > 0) {
    appliedSummary.add(`금지 단어 지정 (${Array.from(prohibitedWords).slice(0, 3).join(', ')})`)
  }

  return {
    noExaggeration,
    priceInquiryDmOnly,
    noStaffFace,
    prohibitedWords: Array.from(prohibitedWords),
    customRestrictions: Array.from(customRestrictions),
    appliedSummary: Array.from(appliedSummary),
  }
}

export interface ConversationalPolicyScenario {
  id: string
  dimension: 'APPROVAL' | 'DAILY_LIMIT' | 'SPEND_LIMIT' | 'HANDOFF' | 'KILL_SWITCH'
  scenarioTitle: string
  scenarioDescription: string
  recommendedChoice: string
  choiceOptions: Array<{
    id: string
    label: string
    description: string
    policyPatch: Partial<OperatingPolicyRules>
  }>
}

export const CONVERSATIONAL_POLICY_SCENARIOS: ConversationalPolicyScenario[] = [
  {
    id: 'scen-approval',
    dimension: 'APPROVAL',
    scenarioTitle: '게시 전 사장님 확인 및 승인',
    scenarioDescription: '영업 중 AI가 멋대로 발행하여 곤란하지 않도록, 소희가 작성한 글을 사장님이 먼저 검토할지 결정합니다.',
    recommendedChoice: 'always_require',
    choiceOptions: [
      {
        id: 'always_require',
        label: '무조건 사장님 승인 후 발행 (안심 모드, 권장)',
        description: '사장님이 직접 승인 버튼을 누르기 전에는 단 한 건의 글도 외부에 발행되지 않습니다.',
        policyPatch: {
          publishApprovalLevel: 'always_require',
          requireApprovalBeforePublish: true,
        },
      },
      {
        id: 'conditional_auto',
        label: '신뢰도 높은 글은 조건부 자동 발행',
        description: '하네스 검증 기준을 충족하는 글은 사장님 부재 시에도 정해진 시간에 자동 발행합니다.',
        policyPatch: {
          publishApprovalLevel: 'conditional_auto',
          requireApprovalBeforePublish: false,
        },
      },
    ],
  },
  {
    id: 'scen-limit',
    dimension: 'DAILY_LIMIT',
    scenarioTitle: '일일 최대 발행 한도',
    scenarioDescription: '피드 도배로 인한 고객 피로도를 방지하고 매장 인지도를 꾸준히 유지할 수 있는 발행 빈도를 정합니다.',
    recommendedChoice: '1_post',
    choiceOptions: [
      {
        id: '1_post',
        label: '하루 1건 (정갈한 추천, 권장)',
        description: '피로감 없이 고객에게 가장 강력한 인상을 남기는 최적의 일일 발행량입니다.',
        policyPatch: { maxDailyPublishCount: 1 },
      },
      {
        id: '2_posts',
        label: '하루 2건 (아침/저녁 소통)',
        description: '오전 매장 오픈 소식과 저녁 시그니처 메뉴 소개를 나누어 발행합니다.',
        policyPatch: { maxDailyPublishCount: 2 },
      },
    ],
  },
  {
    id: 'scen-spend',
    dimension: 'SPEND_LIMIT',
    scenarioTitle: '일일 광고 및 지출 한도',
    scenarioDescription: '의도치 않은 과도한 광고비 지출을 방지하기 위해 일일 지출 상한선을 설정합니다.',
    recommendedChoice: '10k_krw',
    choiceOptions: [
      {
        id: '10k_krw',
        label: '일일 10,000원 한도 (소상공인 기본 권장)',
        description: '하루 최대 1만 원까지만 집행되도록 안전 가드를 설정합니다.',
        policyPatch: { dailySpendLimitKrw: 10000 },
      },
      {
        id: '30k_krw',
        label: '일일 30,000원 한도 (적극적 홍보 모드)',
        description: '주말이나 특별 프로모션 기간에 적합한 탄력적 지출 한도입니다.',
        policyPatch: { dailySpendLimitKrw: 30000 },
      },
    ],
  },
  {
    id: 'scen-handoff',
    dimension: 'HANDOFF',
    scenarioTitle: '고객 불만 및 가격 문의 사람 인계',
    scenarioDescription: 'AI의 오답변으로 인한 사고를 방지하기 위해 불만이나 민감한 가격 문의는 사장님이 직접 확인합니다.',
    recommendedChoice: 'handoff_all',
    choiceOptions: [
      {
        id: 'handoff_all',
        label: '컴플레인 및 가격 문의 사장님 신속 인계 (권장)',
        description: '부정적 감정이나 견적 문의 감지 시 자동응대를 멈추고 사장님께 알림을 보냅니다.',
        policyPatch: {
          handoffOnComplaint: true,
          handoffOnPriceInquiry: true,
          handoffOnUncertainty: true,
        },
      },
    ],
  },
  {
    id: 'scen-killswitch',
    dimension: 'KILL_SWITCH',
    scenarioTitle: '긴급 중단 (Kill Switch) 비상 방어',
    scenarioDescription: '돌발 상황이나 비상 시 소희의 모든 외부 활동을 신속하게 멈춥니다.',
    recommendedChoice: 'ready_enabled',
    choiceOptions: [
      {
        id: 'ready_enabled',
        label: '긴급 중단 가드 상시 활성화 (기본 권장)',
        description: '이상 감지 또는 비상 버튼 작동 시 모든 외부 게시와 고객 응대를 즉각 동결합니다.',
        policyPatch: { emergencyStop: false, stopOnConsecutiveFailures: 3 },
      },
    ],
  },
]

export function extractConversationalOperatingPolicyDraft(
  utterance: string,
  existingRules: Partial<OperatingPolicyRules> = {}
): OperatingPolicyRules {
  const text = utterance.trim()
  const lower = text.toLowerCase()
  const rules: OperatingPolicyRules = {
    ...DEFAULT_OPERATING_POLICY_RULES,
    ...existingRules,
  }

  // 1. Publish Approval Level
  if (
    lower.includes('사장님 승인 없이') ||
    lower.includes('승인 없이') ||
    lower.includes('조건부') ||
    lower.includes('자동 발행')
  ) {
    rules.publishApprovalLevel = 'conditional_auto'
    rules.requireApprovalBeforePublish = false
  } else if (
    lower.includes('무조건') ||
    lower.includes('확인하고') ||
    lower.includes('승인') ||
    lower.includes('직접 확인')
  ) {
    rules.publishApprovalLevel = 'always_require'
    rules.requireApprovalBeforePublish = true
  }

  // 2. Max Daily Count
  const countMatch = text.match(/(?:하루에|하루)\s*([0-9]+)\s*(?:개|건)/)
  if (countMatch && countMatch[1]) {
    const parsed = parseInt(countMatch[1], 10)
    if (parsed >= 1 && parsed <= 20) {
      rules.maxDailyPublishCount = parsed
    }
  }

  // 3. Human Handoff rules
  if (lower.includes('컴플레인') || lower.includes('불만')) {
    rules.handoffOnComplaint = true
  }
  if (lower.includes('가격') || lower.includes('견적')) {
    rules.handoffOnPriceInquiry = true
  }

  // 4. Spend limit (dynamic parsing)
  const spendMatch = text.match(/([0-9,]+)\s*(만)?원/)
  if (spendMatch && (lower.includes('광고비') || lower.includes('예산') || lower.includes('비용') || lower.includes('지출'))) {
    const rawNum = parseInt(spendMatch[1].replace(/,/g, ''), 10)
    if (!isNaN(rawNum)) {
      const isManWon = spendMatch[2] === '만' || spendMatch[0].includes('만원')
      const amount = isManWon ? rawNum * 10000 : rawNum
      if (amount >= 1000 && amount <= 10000000) {
        rules.dailySpendLimitKrw = amount
      }
    }
  }

  return rules
}

export interface KillSwitchState {
  workspaceId: string
  isEngaged: boolean
  engagedByUserId?: string
  engagedAt?: string
  disengagedAt?: string
  reason?: string
}

export function engageEmergencyKillSwitch(params: {
  workspaceId: string
  userId: string
  reason: string
}): KillSwitchState {
  const now = new Date().toISOString()
  return Object.freeze({
    workspaceId: params.workspaceId,
    isEngaged: true,
    engagedByUserId: params.userId,
    engagedAt: now,
    reason: params.reason,
  })
}

export function disengageEmergencyKillSwitch(params: {
  workspaceId: string
  userId: string
}): KillSwitchState {
  const now = new Date().toISOString()
  return Object.freeze({
    workspaceId: params.workspaceId,
    isEngaged: false,
    disengagedAt: now,
  })
}

export function evaluatePublishSafetyUnderKillSwitch(
  rules: OperatingPolicyRules,
  killSwitch?: KillSwitchState
): { allowed: boolean; blockedReason?: string } {
  if (rules.emergencyStop || killSwitch?.isEngaged) {
    return {
      allowed: false,
      blockedReason:
        '긴급 킬스위치(Kill Switch)가 작동 중입니다. 사장님의 안전한 보호를 위해 모든 자동 발행 및 외부 호출이 올스톱되었습니다.',
    }
  }

  return { allowed: true }
}

export function sanitizeAndTranslateError(rawError: unknown): HumanTranslatedError {
  const errorString =
    typeof rawError === 'string'
      ? rawError
      : rawError instanceof Error
      ? rawError.message
      : JSON.stringify(rawError || '')

  // 1. Cross-tenant access denial (strictly scrub tenant UUIDs/IDs)
  if (
    errorString.includes('CROSS_TENANT_ACCESS_DENIED') ||
    errorString.includes('CROSS_TENANT_POLICY_DENIED') ||
    errorString.includes('tenant mismatch') ||
    errorString.includes('unauthorized workspace')
  ) {
    return {
      whatHappened: '매장 계정의 접근 권한을 확인하지 못했습니다.',
      whatSoheeDid: '안전을 위해 다른 매장의 정보가 섞이지 않도록 차단했습니다.',
      ownerAction: '현재 로그인한 계정으로 다시 접속해 주세요.',
    }
  }

  // 2. Database/Postgres SQL permission or syntax leaks
  if (
    errorString.includes('PostgresError') ||
    errorString.includes('SQLSTATE') ||
    errorString.includes('relation') ||
    errorString.includes('unique constraint') ||
    errorString.includes('database error')
  ) {
    return {
      whatHappened: '일시적인 저장 충돌이 발생했습니다.',
      whatSoheeDid: '데이터 무결성을 보호하기 위해 안전 모드로 전환했습니다.',
      ownerAction: '잠시 후 다시 저장해 주세요.',
    }
  }

  // 3. Raw OAuth tokens or scopes leaks
  if (
    errorString.includes('EAABw') ||
    errorString.includes('Bearer') ||
    errorString.includes('token') ||
    errorString.includes('scope') ||
    errorString.includes('invalid_grant') ||
    errorString.includes('OAuth')
  ) {
    return {
      whatHappened: 'SNS 로그인 인증 세션이 만료되었습니다.',
      whatSoheeDid: '사장님의 안전한 계정 관리를 위해 이전 토큰을 정리했습니다.',
      ownerAction: '채널 연동 화면에서 다시 공식 로그인을 진행해 주세요.',
    }
  }

  // 4. Default fallback using base translator
  return translateInternalErrorToHuman(rawError)
}

export interface ConfirmConversationalPolicyParams {
  workspaceId: string
  callerTenantId?: string
  userId: string
  rules: OperatingPolicyRules
  explicitApprovalPhrase?: string
  isExplicitlyApproved: boolean
  versionNumber?: number
}

export type ImmutableOperatingPolicyRules = Readonly<
  Omit<OperatingPolicyRules, 'allowedChannels'> & {
    readonly allowedChannels: readonly string[]
  }
>

export interface ImmutableOperatingPolicySnapshot {
  id: string
  workspaceId: string
  ruleKey: string
  versionNumber: number
  status: 'active'
  isImmutable: true
  rules: ImmutableOperatingPolicyRules
  confirmedByUserId: string
  confirmedAt: string
  immutableHash: string
}

export function confirmConversationalPolicyWithExplicitGate(
  params: ConfirmConversationalPolicyParams
): ImmutableOperatingPolicySnapshot {
  const {
    workspaceId,
    callerTenantId = workspaceId,
    userId,
    rules,
    explicitApprovalPhrase,
    isExplicitlyApproved,
    versionNumber = 1,
  } = params

  // Invariant 1: Human User Authorization required (Zero bot-only confirmation)
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    throw new Error(
      'AUTHZ_CONFIRM_USER_REQUIRED: 운영 정책 확정은 반드시 사람 사용자의 승인이 필요합니다 (Agent 단독 확정 금지).'
    )
  }

  // Invariant 2: Multi-Tenant Isolation
  if (callerTenantId !== workspaceId) {
    throw new Error(
      'CROSS_TENANT_POLICY_DENIED: 다른 테넌트의 운영 정책은 확정하거나 수정할 수 없습니다.'
    )
  }

  // Invariant 3: Explicit Confirm Boundary
  const hasPhrase = explicitApprovalPhrase?.includes('이 기준으로 사용')
  if (!isExplicitlyApproved || !hasPhrase) {
    throw new Error(
      "EXPLICIT_CONFIRMATION_REQUIRED: 운영 정책 확정을 위해서는 사용자의 명시적인 '이 기준으로 사용' 승인이 필요합니다."
    )
  }

  // Invariant 4: Rule constraints validation
  const validation = validateOperatingPolicyRules(rules)
  if (!validation.valid) {
    throw new Error(`운영 정책 유효성 검사 실패: ${validation.errors.join(', ')}`)
  }

  const now = new Date().toISOString()
  const frozenRules = Object.freeze({
    ...rules,
    allowedChannels: Object.freeze([...rules.allowedChannels]),
  })

  // Compute SHA-256 immutable hash
  const hashPayload = JSON.stringify({
    workspaceId,
    versionNumber,
    rules: frozenRules,
    confirmedAt: now,
    confirmedByUserId: userId,
  })
  const immutableHash = createHash('sha256').update(hashPayload).digest('hex')

  const snapshot: ImmutableOperatingPolicySnapshot = {
    id: `policy_${Date.now()}_v${versionNumber}`,
    workspaceId,
    ruleKey: `approval_policy_v${versionNumber}`,
    versionNumber,
    status: 'active',
    isImmutable: true,
    rules: frozenRules,
    confirmedByUserId: userId,
    confirmedAt: now,
    immutableHash,
  }

  return Object.freeze(snapshot)
}
