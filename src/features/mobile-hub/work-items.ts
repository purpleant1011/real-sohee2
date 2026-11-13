import type { WorkItem, WorkStatus } from './filters'

export interface WorkRow extends WorkItem {
  /** 서버가 준 원본 상태. 화면 문구는 이 값에서 파생하고 임의로 완료 처리하지 않는다. */
  rawState: string
  statusLabel: string
  channelLabel: string
  href: string
  /** 게시 확인 근거. 없으면 상세에서 "게시 확인 전"으로 표시한다. */
  publishedUrl: string | null
  isApproved: boolean
  createdAt: string | null
}

export interface WorkListSource {
  items: WorkRow[]
  error: boolean
  /**
   * 모바일 요약은 제한된 content_items 목록만 읽는다. 전체 업무 원장·승인·게시 근거
   * 조회가 아니므로 빈 응답도 "확정 0건"으로 주장하지 않고 partial 로 표시한다.
   */
  complete: boolean
}

const CHANNEL_LABEL: Record<string, string> = {
  instagram: '인스타그램',
  threads: '스레드',
  naver: '네이버',
  naver_blog: '네이버 블로그',
  daangn: '당근',
}

const STATUS_LABEL: Record<string, string> = {
  draft: '초안',
  planning: '초안',
  idle: '초안',
  queued: '초안',
  paused: '초안',
  waiting_for_approval: '검토 중',
  pending_approval: '검토 중',
  review: '검토 중',
  blocked: '확인 필요',
  failed: '확인 필요',
  cancelled: '취소됨',
  scheduled: '예약됨',
  publishing: '게시 확인 중',
  executing: '게시 확인 중',
  running: '게시 확인 중',
  streaming: '게시 확인 중',
  verifying: '게시 확인 중',
  retrying: '게시 확인 중',
  partially_completed: '게시 확인 중',
  completed: '게시 확인',
  published: '게시 확인',
}

/** 5개 세그먼트로 묶되, 확인이 필요한 상태도 숨기지 않는다. */
export function deriveWorkStatus(rawState: string, isApproved: boolean, isPublished: boolean): WorkStatus {
  if (isPublished) return 'confirmed'
  if (rawState === 'published' || rawState === 'completed') return 'verifying'
  if (rawState === 'scheduled') return 'scheduled'
  if (rawState === 'waiting_for_approval' || rawState === 'pending_approval' || rawState === 'review') return 'review'
  if (['publishing', 'executing', 'running', 'streaming', 'verifying', 'retrying', 'partially_completed'].includes(rawState)) return 'verifying'
  if (!isApproved && rawState === 'draft') return 'draft'
  return 'draft'
}

export function statusLabelFor(rawState: string, isApproved: boolean, isPublished: boolean): string {
  if (isPublished) return '게시 확인'
  if (rawState === 'published') return '게시 확인 전'
  if (rawState === 'completed') return isApproved ? '승인 완료 · 게시 확인 전' : '게시 확인 전'
  if (STATUS_LABEL[rawState]) return STATUS_LABEL[rawState]
  // 모르는 상태를 "초안"으로 단정하지 않는다.
  return '상태 확인 필요'
}

export function toWorkRow(raw: unknown, workspaceId: string): WorkRow | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const itemWorkspace = item.workspaceId ?? item.workspace_id
  if (!workspaceId || itemWorkspace !== workspaceId) return null
  if (item.workspaceId !== undefined && item.workspaceId !== workspaceId) return null
  if (item.workspace_id !== undefined && item.workspace_id !== workspaceId) return null
  const id = item.contentId ?? item.id
  if (typeof id !== 'string' || id.length === 0) return null
  const rawState = typeof item.status === 'string' ? item.status : ''
  const isApproved = item.isApproved === true || item.is_approved === true
  const isPublished = item.publicationVerified === true
  const publicationUnverified = !isPublished && ['published', 'completed'].includes(rawState)
  const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : '제목 확인 필요'
  const channel = typeof item.channel === 'string' ? item.channel : ''
  const publishedUrl = typeof item.publishedUrl === 'string' && /^https?:\/\//.test(item.publishedUrl) ? item.publishedUrl : null
  return {
    id,
    title,
    status: publicationUnverified ? 'verifying' : deriveWorkStatus(rawState, isApproved, isPublished),
    rawState,
    statusLabel: publicationUnverified ? '게시 확인 전' : statusLabelFor(rawState, isApproved, isPublished),
    channelLabel: CHANNEL_LABEL[channel] ?? '채널 확인 필요',
    href: `/app/work/${encodeURIComponent(id)}`,
    publishedUrl,
    isApproved,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : typeof item.created_at === 'string' ? item.created_at : null,
  }
}

export function toWorkList(payload: unknown, workspaceId: string): WorkListSource {
  if (!payload || typeof payload !== 'object') return { items: [], error: true, complete: false }
  const raw = payload as Record<string, unknown>
  if (raw.error || raw.success === false) return { items: [], error: true, complete: false }
  if (!Array.isArray(raw.contents)) return { items: [], error: true, complete: false }
  const items = raw.contents.map(item => toWorkRow(item, workspaceId)).filter((item): item is WorkRow => item !== null)
  return { items, error: false, complete: raw.complete === true && raw.hasMore === false && items.length === raw.contents.length }
}
