import type { ContentVersionSummary } from '@/features/content/types'

export type HistoryMessage = Readonly<{ id: string; role: 'user' | 'assistant'; text: string; at: string }>
export type VersionTimelineItem = Readonly<{ id: string; versionNumber: number; reason: string; createdAt: string; current: boolean; caption: string }>
export type LivePost = Readonly<{ url: string; verifiedAt: string }>
export type WorkStudioContext = Readonly<{
  thread: Readonly<{ id: string; title: string | null }> | null
  messages: readonly HistoryMessage[]
  livePost: LivePost | null
  historyError: boolean
  /** 이 원고 채널의 연결 상태. 확인하지 못하면 'unknown'(연결됨으로 단정하지 않는다). */
  connectionStatus?: 'connected' | 'expired' | 'disconnected' | 'unknown'
  publishAttemptId?: string | null
  providerPostId?: string | null
  publishedAt?: string | null
}>

const MAX_TEXT = 600

/** 사용자 지시와 소희 답변만 시간순으로. 빈 값·내부 역할은 걸러 내고, 긴 글은 줄인다. */
export function toHistoryMessages(rows: ReadonlyArray<{ id: string; role: string; content: unknown; created_at: string }>): HistoryMessage[] {
  return rows
    .filter(r => (r.role === 'user' || r.role === 'assistant') && typeof r.content === 'string' && r.content.trim().length > 0)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .map(r => {
      const text = (r.content as string).trim()
      return { id: r.id, role: r.role as 'user' | 'assistant', text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text, at: r.created_at }
    })
}

export type ReceiptRow = { verified: boolean | null; verified_at: string | null; result_url: string | null; external_url: string | null; provider_post_url: string | null }
export type AttemptFallbackRow = {
  status: string | null
  finished_at?: string | null
  started_at?: string | null
  destination_url?: string | null
}

/** provider 접수(accepted)가 아니라 읽어서 확인(verified)된 영수증의 https 주소를 우선하고, 없을 때 성공한 발행 시도의 destination_url(https)로 폴백한다. */
export function pickVerifiedPostUrl(
  receipts: ReadonlyArray<ReceiptRow>,
  attempts?: ReadonlyArray<AttemptFallbackRow>,
): LivePost | null {
  const sorted = [...receipts].sort((a, b) => Date.parse(b.verified_at ?? '') - Date.parse(a.verified_at ?? ''))
  for (const r of sorted) {
    if (r.verified !== true || !r.verified_at) continue
    for (const candidate of [r.provider_post_url, r.result_url, r.external_url]) {
      if (typeof candidate === 'string' && /^https:\/\/[^\s]+$/.test(candidate)) return { url: candidate, verifiedAt: r.verified_at }
    }
  }

  if (!attempts || attempts.length === 0) return null

  const validAttempts = attempts
    .filter(a => a.status === 'succeeded' && typeof a.destination_url === 'string' && /^https:\/\/[^\s]+$/.test(a.destination_url))
    .sort((a, b) => {
      const timeB = Date.parse(b.finished_at ?? b.started_at ?? '') || 0
      const timeA = Date.parse(a.finished_at ?? a.started_at ?? '') || 0
      return timeB - timeA
    })

  const latest = validAttempts[0]
  if (!latest || !latest.destination_url) return null

  const verifiedAt = latest.finished_at || latest.started_at || new Date().toISOString()
  return { url: latest.destination_url, verifiedAt }
}

export function buildVersionTimeline(
  versions: ReadonlyArray<Pick<ContentVersionSummary, 'id' | 'versionNumber' | 'revisionReason' | 'createdAt' | 'caption'>>,
  currentVersionId: string | null,
): VersionTimelineItem[] {
  return [...versions]
    .sort((a, b) => b.versionNumber - a.versionNumber)
    .map(v => ({
      id: v.id,
      versionNumber: v.versionNumber,
      reason: v.revisionReason?.trim() || (v.versionNumber === 1 ? '처음 만든 원고' : '수정한 원고'),
      createdAt: v.createdAt,
      current: v.id === currentVersionId,
      caption: v.caption,
    }))
}

/** channel_connections.status → 패널이 쓰는 4단계. 모르는 값은 unknown. */
export function toPanelConnectionStatus(status: string | null | undefined): 'connected' | 'expired' | 'disconnected' | 'unknown' {
  if (!status) return 'disconnected'
  if (status === 'connected') return 'connected'
  if (status === 'expired' || status === 'reauth_required') return 'expired'
  if (status === 'disconnected' || status === 'revoked') return 'disconnected'
  return 'unknown'
}
