export type ApprovalCategory = 'comment_reply' | 'post_publish' | 'dm_reply' | 'proposal'

export type ApprovalChannel = 'instagram' | 'threads' | 'naver_blog' | 'daangn' | 'multi'

export interface RoiImpact {
  type: 'reach' | 'revenue' | 'retention'
  label: string
  value: string
}

export interface HomeApprovalItem {
  id: string
  category: ApprovalCategory
  channel: ApprovalChannel
  title: string
  targetLabel: string
  sourceSnippet: string
  draftSnippet: string
  urgency?: string
  imageUrl?: string
  fullCaption?: string
  hashtags?: string[]
  suggestedBooking?: {
    date: string
    time: string
    service: string
    depositKrw?: number
  }
  goldenTimeLabel?: string
  roiImpact?: RoiImpact
  metadata?: Record<string, unknown>
  createdAt: string
}

export interface HomeApprovalsSummary {
  total: number
  comments: number
  posts: number
  dms: number
  proposals: number
}

export interface HomeApprovalsResponse {
  autonomyLevel: 'L1' | 'L2' | 'L3'
  items: HomeApprovalItem[]
  autoHandledCount: number
  autoHandledLabel?: string
  summary: HomeApprovalsSummary
  knowledgeStatus?: {
    factsCount: number
    sourcesCount: number
    needsKnowledgePrompt: boolean
  }
}

export interface BatchApprovalActionInput {
  action: 'approve' | 'dismiss'
  itemIds?: string[]
  all?: boolean
  createBooking?: boolean
  fingerprints?: Record<string, string>
}

export interface BatchApprovalResult {
  succeededIds: string[]
  failedIds: string[]
  /**
   * 결과를 단정할 수 없어 대조가 필요한 항목. 성공도 아니지만 재시도해도 안전하다고 볼 수 없으므로
   * failedIds와 분리한다. (외부 전송 접수 여부 불확실, 또는 로컬 기록 미대사/부분 반영)
   */
  reconciliationRequiredIds?: string[]
  processedCount: number
}
