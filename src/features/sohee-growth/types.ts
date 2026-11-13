export type MembershipTierKey = 'TRIAL' | 'PENDING_REVIEW' | 'FORMAL' | 'REJECTED'

/** DB에서 읽은 "실제로 저장된 것"만 담는다. 점수·해금은 모두 여기서 파생한다. */
export interface GrowthEvidence {
  profile: {
    nameValid: boolean
    industryValid: boolean
    locationValid: boolean
    summaryValid: boolean
    voiceValid: boolean
    keywordCount: number
    prohibitedTermCount: number
  }
  /** 확정된(active) 지식의 카테고리별 개수. 키는 대문자(MENU, PRICE, FAQ ...). */
  factCounts: Record<string, number>
  harness: { text: boolean; image: boolean; approvalPolicy: boolean }
  /** 올린 자료(파일·URL·직접 입력) 수. 실패·거절·일시정지는 제외. */
  sourceCount: number
  channels: { instagram: boolean; threads: boolean }
  tier: MembershipTierKey
}

export type CategoryKey = 'shop' | 'customer' | 'style' | 'caution' | 'materials' | 'manual'

export interface CategoryScore {
  key: CategoryKey
  label: string
  percent: number
  weight: number
}

export type RequirementKey =
  | 'shop_basic'
  | 'products'
  | 'voice'
  | 'image_style'
  | 'caution'
  | 'channel'
  | 'faq'
  | 'manual'
  | 'booking_rules'

export type TeachDestination = 'teach' | 'work' | 'tools'

export interface RequirementResult {
  key: RequirementKey
  label: string
  done: boolean
  /** 아직 남은 양을 사람이 읽는 말로. 예: "2개 더" */
  remaining?: string
  destination: TeachDestination
}

export type JobKey =
  | 'post_social'
  | 'reply_comments'
  | 'write_blog'
  | 'write_daangn'
  | 'booking_guide'
  | 'kakao_1on1'

export type JobStatus = 'available' | 'preview_only' | 'learning' | 'locked' | 'membership' | 'coming_soon'

export interface JobResult {
  key: JobKey
  label: string
  status: JobStatus
  /** 카드 아래 한 줄 설명. 예: "승인 후 실행", "고객 질문 2개 더" */
  note: string
  /** 해당 업무에 필요한 전체 요건 (충족된 것도 포함). coming_soon 은 빈 배열. */
  needed: RequirementResult[]
  missing: RequirementResult[]
}

export interface LadderStep {
  level: number
  name: string
  state: 'done' | 'current' | 'upcoming'
  soon?: boolean
}

export interface LevelInfo {
  level: 0 | 1 | 2 | 3 | 4
  name: string
  nextName: string | null
  ladder: LadderStep[]
}

export interface NextStep {
  requirementKey: RequirementKey
  title: string
  destination: TeachDestination
}

export interface GrowthSnapshot {
  completenessPercent: number
  level: LevelInfo
  categories: CategoryScore[]
  requirements: RequirementResult[]
  jobs: JobResult[]
  nextStep: NextStep | null
  counts: { facts: number; sources: number }
  tier: MembershipTierKey
  generatedAt: string
}
