import type { FullContentDetail } from '@/components/v088/content/content-detail-modal'

export type { FullContentDetail }

export type ContentViewState =
  | { status: 'LOADING' }
  | { status: 'ERROR'; errorMessage: string }
  | { status: 'EMPTY'; items: [] }
  | { status: 'DATA'; items: FullContentDetail[] }

export interface ContentApiResponse {
  contents?: unknown[]
  error?: {
    code?: string
    message?: string
  }
  success?: boolean
}

export function parseContentApiResponse(
  payload: unknown,
  expectedWorkspaceId?: string
): ContentViewState {
  if (!payload || typeof payload !== 'object') {
    return {
      status: 'ERROR',
      errorMessage: '유효하지 않은 응답 형식입니다.',
    }
  }

  const raw = payload as Record<string, unknown>

  // Explicit error branch (ERROR != EMPTY)
  if (raw.error && typeof raw.error === 'object') {
    const errObj = raw.error as Record<string, unknown>
    return {
      status: 'ERROR',
      errorMessage: (errObj.message as string) || '콘텐츠 목록을 불러오지 못했습니다.',
    }
  }

  // Canonical payload inspection: contents array must exist
  const contents = raw.contents
  if (!Array.isArray(contents)) {
    return {
      status: 'ERROR',
      errorMessage: '콘텐츠 목록 데이터가 존재하지 않습니다.',
    }
  }

  // Workspace isolation filter: discard foreign or mismatched workspace items
  const filtered = contents.filter((item) => {
    if (!item || typeof item !== 'object') return false
    if (!expectedWorkspaceId) return true
    const itemWsId = (item as any).workspaceId || (item as any).workspace_id
    // If workspaceId is present on the item, enforce exact match
    return !itemWsId || itemWsId === expectedWorkspaceId
  })

  if (filtered.length === 0) {
    return {
      status: 'EMPTY',
      items: [],
    }
  }

  const items: FullContentDetail[] = filtered.map((item: any) => {
    const rawChannel = String(item.channel || '').toLowerCase()
    let channel: FullContentDetail['channel'] = 'instagram'
    if (rawChannel === 'threads') channel = 'threads'
    else if (rawChannel === 'naver_blog' || rawChannel === 'naver') channel = 'naver'
    else if (rawChannel === 'daangn') channel = 'daangn'

    const isApproved = Boolean(item.isApproved || item.is_approved)
    const isPublished = item.status === 'published'
    const state: FullContentDetail['state'] = isApproved
      ? isPublished
        ? 'completed'
        : 'scheduled'
      : 'waiting_for_approval'

    const createdAtDate = item.createdAt || item.created_at
    const scheduledDate = createdAtDate
      ? new Date(createdAtDate).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
      : '일정 미정'

    return {
      id: item.contentId || item.id,
      title: item.title || '제목 없음',
      channel,
      category: 'feed' as const,
      state,
      scheduledDate,
      qcScore: typeof item.qcScore === 'number' ? item.qcScore : 98,
      inquiryGoal: item.inquiryGoal || '매장 인지도 및 방문 증대',
      targetKeyword: Array.isArray(item.hashtags) && item.hashtags.length > 0
        ? item.hashtags.slice(0, 2).join(' ')
        : '#소희AI',
      images: Array.isArray(item.mediaUrls) ? item.mediaUrls : [],
      mediaAssets: Array.isArray(item.mediaAssets) ? item.mediaAssets : [],
      bodyContent: item.caption || item.body || '',
      hashtags: Array.isArray(item.hashtags) ? item.hashtags : [],
      versionId: item.currentVersionId || item.versionId || '',
      versionNumber: item.versionNumber || 1,
      fingerprint: item.fingerprint || '',
      isApproved,
      approvalId: item.approvalId || null,
      isPublished,
    }
  })

  return {
    status: 'DATA',
    items,
  }
}
