export interface QuickPostItem {
  missionId: string
  status: string
  topic: string
  createdAt: string
  copies: { instagram: { caption: string; hashtags?: string[] }; threads: { content: string } }
  imageIds: string[]
  imageUrl: string | null
  channels: { provider: string; handle: string; profileUrl?: string }[]
  approvalFingerprint: string
  businessName: string
  revision: number
  receipts: Record<string, { stage: string; permalink?: string; errorMessage?: string }>
  supportsApprovalActions?: boolean
}

export type PostStage = 'waiting' | 'publishing' | 'published' | 'partial' | 'failed' | 'other'

export function stageOf(status: string): PostStage {
  switch (status) {
    case 'AWAITING_APPROVAL':
    case 'APPROVED':
      return 'waiting'
    case 'EXECUTING':
      return 'publishing'
    case 'PUBLISHED_VERIFIED':
    case 'COMPLETED':
    case 'LISTENING':
      return 'published'
    case 'FAILED':
      return 'failed'
    default:
      return 'other'
  }
}

export const STAGE_LABEL: Record<PostStage, string> = {
  waiting: '확인 필요',
  publishing: '발행 중',
  published: '발행됨',
  partial: '일부만 발행됨',
  failed: '발행 실패',
  other: '진행 중',
}
