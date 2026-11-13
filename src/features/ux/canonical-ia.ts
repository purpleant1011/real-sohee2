/**
 * Canonical IA & Customer Language Filter (ANI-1053, ANI-1054)
 *
 * Enforces:
 * 1. 6 Canonical IA Destintations: 소희 / 작업 / 콘텐츠 / 채널 / 리포트 / 설정
 * 2. Zero Technical Jargon in Customer-facing UI: Strips MCP, Outcome OS, Figma IDs, Harness
 * 3. Multi-modal Status Badges: Accessible, color-independent with clear recovery actions
 */

export interface CanonicalNavDestination {
  href: string
  label: '소희' | '작업' | '콘텐츠' | '채널' | '리포트' | '설정'
  iconName: string
  description: string
}

export const CANONICAL_9TH_IA: readonly CanonicalNavDestination[] = [
  {
    href: '/app',
    label: '소희',
    iconName: 'Sparkles',
    description: '소희와의 대화 및 빠른 마케팅 지시',
  },
  {
    href: '/app/work',
    label: '작업',
    iconName: 'ListOrdered',
    description: '요청된 마케팅 업무 타임라인 및 진행 상태',
  },
  {
    href: '/app/content',
    label: '콘텐츠',
    iconName: 'FileText',
    description: '작성 및 승인된 마케팅 원고 보관함',
  },
  {
    href: '/app/channels',
    label: '채널',
    iconName: 'Share2',
    description: '인스타그램·스레드 등 SNS 채널 연동',
  },
  {
    href: '/app/reports',
    label: '리포트',
    iconName: 'ChartNoAxesCombined',
    description: '마케팅 성과 지표 및 외부 발행 영수증',
  },
  {
    href: '/app/settings/business',
    label: '설정',
    iconName: 'Settings',
    description: '우리 매장 정보 및 브랜드 보이스 설정',
  },
]

export interface OnboardingStepDefinition {
  step: number
  key: 'STORE_INFO' | 'PRODUCTS_SERVICES' | 'TARGET_AUDIENCE' | 'BRAND_VOICE' | 'CHANNEL_CONNECT' | 'FIRST_WORK'
  title: string
}

export const FIRST_OUTCOME_ONBOARDING_STEPS: readonly OnboardingStepDefinition[] = [
  { step: 1, key: 'STORE_INFO', title: '우리 매장 정보' },
  { step: 2, key: 'PRODUCTS_SERVICES', title: '대표 상품 및 서비스' },
  { step: 3, key: 'TARGET_AUDIENCE', title: '주요 고객층' },
  { step: 4, key: 'BRAND_VOICE', title: '말투 및 금지어' },
  { step: 5, key: 'CHANNEL_CONNECT', title: 'SNS 채널 연동' },
  { step: 6, key: 'FIRST_WORK', title: '첫 마케팅 업무 시작' },
]

/**
 * Strips internal engineering jargon and translates to customer-friendly Korean terminology.
 */
export function sanitizeCustomerFacingCopy(copy: string): string {
  if (!copy) return ''

  return copy
    .replace(/MCP Gateway/gi, '소희 AI 시스템')
    .replace(/Harness Lineage/gi, '마케팅 지침')
    .replace(/Outcome OS/gi, '소희 마케팅 엔진')
    .replace(/\[?Figma[^\]]*\]?/gi, '')
    .replace(/raw_request_id=[a-zA-Z0-9_-]+/gi, '')
    .replace(/Autonomy Envelope/gi, '자동 실행 범위')
    .trim()
}

export type CustomerFacingOutcomeStatus =
  | 'DRAFT_CREATING'
  | 'APPROVAL_PENDING'
  | 'PUBLISHING'
  | 'EXTERNAL_VERIFIED'
  | 'UNKNOWN_RECOVERING'
  | 'FAILED'

export interface CustomerStatusBadgeInfo {
  status: CustomerFacingOutcomeStatus
  label: string
  iconName: string
  colorVariant: 'neutral' | 'warning' | 'info' | 'success' | 'danger'
  ariaRole: 'status'
  accessibleText: string
  isRecoverable: boolean
  recoveryActionLabel?: string
}

export function formatCustomerStatusBadge(status: CustomerFacingOutcomeStatus): CustomerStatusBadgeInfo {
  switch (status) {
    case 'DRAFT_CREATING':
      return {
        status,
        label: '초안 작성 중',
        iconName: 'Loader2',
        colorVariant: 'info',
        ariaRole: 'status',
        accessibleText: '상태: 초안 작성 중입니다. 소희가 우리 매장에 맞는 마케팅 원고를 작성하고 있습니다.',
        isRecoverable: false,
      }
    case 'APPROVAL_PENDING':
      return {
        status,
        label: '승인 대기',
        iconName: 'Clock',
        colorVariant: 'warning',
        ariaRole: 'status',
        accessibleText: '상태: 승인 대기. 원고 내용을 확인하고 승인해주세요.',
        isRecoverable: false,
      }
    case 'PUBLISHING':
      return {
        status,
        label: '발행 중',
        iconName: 'Send',
        colorVariant: 'info',
        ariaRole: 'status',
        accessibleText: '상태: 발행 중. SNS 채널로 콘텐츠를 게시 중입니다.',
        isRecoverable: false,
      }
    case 'EXTERNAL_VERIFIED':
      return {
        status,
        label: '발행 완료',
        iconName: 'CheckCircle2',
        colorVariant: 'success',
        ariaRole: 'status',
        accessibleText: '상태: 발행 완료. 외부 SNS 채널에 정상 게시되었으며 영수증이 확인되었습니다.',
        isRecoverable: false,
      }
    case 'UNKNOWN_RECOVERING':
      return {
        status,
        label: '게시 확인 중',
        iconName: 'HelpCircle',
        colorVariant: 'warning',
        ariaRole: 'status',
        accessibleText: '상태: 게시 확인 중 (외부 플랫폼 확인 중). 네트워크 지연으로 게시 여부를 자동 재확인하고 있습니다.',
        isRecoverable: true,
        recoveryActionLabel: '게시 상태 다시 확인',
      }
    case 'FAILED':
      return {
        status,
        label: '발행 실패',
        iconName: 'AlertCircle',
        colorVariant: 'danger',
        ariaRole: 'status',
        accessibleText: '상태: 발행 실패. 오류가 발생하여 게시되지 않았습니다.',
        isRecoverable: true,
        recoveryActionLabel: '다시 시도하기',
      }
  }
}
