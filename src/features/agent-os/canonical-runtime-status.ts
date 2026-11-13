/**
 * Canonical Runtime Status Contract & Product Language SSOT (ANI-847, ANI-867, ANI-869)
 * 
 * Strict Invariants:
 * 1. RUNNING is ONLY valid when an actual active run exists on server.
 * 2. If PAUSED, IDLE, BLOCKED, or OWNER_ACTION_REQUIRED, optimistic "실행 중" copy is strictly 0.
 * 3. Substrate/Vendor terms (Postiz, Chatwoot, HubSpot, etc.) are abstracted into outcome language.
 */

export type RuntimePrimaryState =
  | 'RUNNING'
  | 'PAUSED'
  | 'IDLE'
  | 'OWNER_ACTION_REQUIRED'
  | 'BLOCKED'
  | 'LEARNING'

export type BlockerCode =
  | 'NO_CREDIT'
  | 'NO_READY_PLUGIN'
  | 'AUTH_REQUIRED'
  | 'DEGRADED'
  | 'RESULT_UNKNOWN'
  | 'FAILED'
  | 'STALE'

export interface RuntimeStatusInput {
  hasActiveRun: boolean
  isPaused: boolean
  ownerActionRequiredCount?: number
  isLearning?: boolean
  blocker?: BlockerCode | null
  creditBalance?: number
  hasReadyPlugin?: boolean
}

export interface RuntimeStatusResolution {
  primaryState: RuntimePrimaryState
  blocker: BlockerCode | null
  badgeLabel: string
  statusHeadline: string
  statusDescription: string
  canExecute: boolean
}

export function resolveCanonicalRuntimeStatus(input: RuntimeStatusInput): RuntimeStatusResolution {
  // 1. Credit Check: If credit balance explicitly 0, blocker is NO_CREDIT
  let effectiveBlocker = input.blocker ?? null
  if (input.creditBalance !== undefined && input.creditBalance <= 0) {
    effectiveBlocker = 'NO_CREDIT'
  } else if (input.hasReadyPlugin === false) {
    effectiveBlocker = 'NO_READY_PLUGIN'
  }

  // 2. Resolve Primary State strictly based on priority hierarchy
  // Priority: PAUSED > BLOCKED > OWNER_ACTION_REQUIRED > RUNNING > LEARNING > IDLE
  let primaryState: RuntimePrimaryState

  if (input.isPaused) {
    primaryState = 'PAUSED'
  } else if (effectiveBlocker !== null) {
    primaryState = 'BLOCKED'
  } else if ((input.ownerActionRequiredCount ?? 0) > 0) {
    primaryState = 'OWNER_ACTION_REQUIRED'
  } else if (input.hasActiveRun) {
    // Invariant: Only RUNNING if active run actually exists
    primaryState = 'RUNNING'
  } else if (input.isLearning) {
    primaryState = 'LEARNING'
  } else {
    primaryState = 'IDLE'
  }

  // 3. Generate canonical, non-hallucinatory UI copies
  const { badgeLabel, statusHeadline, statusDescription } = getCanonicalStatusCopy(primaryState, effectiveBlocker)

  return {
    primaryState,
    blocker: effectiveBlocker,
    badgeLabel,
    statusHeadline,
    statusDescription,
    canExecute: primaryState === 'RUNNING' || primaryState === 'IDLE' || primaryState === 'LEARNING',
  }
}

function getCanonicalStatusCopy(
  state: RuntimePrimaryState,
  blocker: BlockerCode | null
): { badgeLabel: string; statusHeadline: string; statusDescription: string } {
  switch (state) {
    case 'PAUSED':
      return {
        badgeLabel: '일시 정지',
        statusHeadline: '사장님 지시로 자율 업무가 일시 정지되었습니다',
        statusDescription: '새로운 외부 발행이나 크레딧 차감 작업이 모두 멈춰 있습니다. 우측 독에서 언제든 재개할 수 있습니다.',
      }
    case 'BLOCKED':
      if (blocker === 'NO_CREDIT') {
        return {
          badgeLabel: '크레딧 소진',
          statusHeadline: '소희 크레딧이 모두 소진되어 업무가 대기 중입니다',
          statusDescription: '추가 작업을 진행하려면 소희 크레딧을 충전해 주세요.',
        }
      }
      if (blocker === 'NO_READY_PLUGIN') {
        return {
          badgeLabel: '도구 준비 필요',
          statusHeadline: '필요한 외부 도구(플러그인)가 아직 연결되지 않았습니다',
          statusDescription: '나의 소희 > 능력 & 연결 탭에서 채널 및 도구를 연결해 주세요.',
        }
      }
      if (blocker === 'AUTH_REQUIRED') {
        return {
          badgeLabel: '재인증 필요',
          statusHeadline: '외부 채널의 보안 토큰이 만료되어 재인증이 필요합니다',
          statusDescription: '채널 연결 관리에서 안전하게 다시 로그인해 주세요.',
        }
      }
      return {
        badgeLabel: '업무 차단',
        statusHeadline: '안전 보호 규칙에 의해 작업이 보류되었습니다',
        statusDescription: '보안 정책 또는 한도 설정에 따라 실행이 제한되었습니다.',
      }
    case 'OWNER_ACTION_REQUIRED':
      return {
        badgeLabel: '사장님 확인 필요',
        statusHeadline: '사장님의 최종 승인이 필요한 예외 작업이 있습니다',
        statusDescription: '예산 증액, 신규 권한 승인, 또는 개인정보 관련 요청을 확인해 주세요.',
      }
    case 'RUNNING':
      return {
        badgeLabel: '자율 근무 중',
        statusHeadline: '소희가 사장님의 비법 규칙에 맞춰 실시간 작업 중입니다',
        statusDescription: '감지된 고객 문의와 예약 일정을 분석하고 있습니다.',
      }
    case 'LEARNING':
      return {
        badgeLabel: '성과 학습 중',
        statusHeadline: '최근 외부 반응과 실매출 데이터를 분석 중입니다',
        statusDescription: '다음 번 제안과 콘텐츠 품질을 높이기 위한 인과관계를 학습합니다.',
      }
    case 'IDLE':
    default:
      return {
        badgeLabel: '대기 중',
        statusHeadline: '소희가 다음 업무 기회를 모니터링하고 있습니다',
        statusDescription: '새로운 고객 문의나 발행 스케줄이 감지되면 순차적으로 업무를 시작합니다.',
      }
  }
}

/**
 * Product Language SSOT & Vendor Abstraction (ANI-867)
 * Masks substrate technical names into customer-centric outcome terminology
 */
export const PRODUCT_LANGUAGE_MAP: Record<string, string> = {
  postiz: '소희 외부 채널 게이트웨이',
  chatwoot: '통합 고객 상담 라우터',
  hubspot: '고객 관계 원장(CRM)',
  mcp: '소희 표준 도구 프로토콜',
  'gpt-4o': '소희 고지능 브레인',
  'gpt-image-2': '소희 스튜디오 화보 생성기',
}

export function sanitizeVendorTerms(text: string): string {
  let sanitized = text
  for (const [vendor, replacement] of Object.entries(PRODUCT_LANGUAGE_MAP)) {
    const regex = new RegExp(`\\b${vendor}\\b`, 'gi')
    sanitized = sanitized.replace(regex, replacement)
  }
  return sanitized
}
