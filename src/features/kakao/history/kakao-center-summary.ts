import type { KakaoHistoryItem } from './contract'

export interface KakaoSummaryCounts {
  delivered: number
  sent: number
  needsCheck: number
  held: number
  cancelled: number
  total: number
}

export type KakaoFilterTab = 'all' | 'sent' | 'needs_check' | 'held'

export const KAKAO_FILTER_TABS: ReadonlyArray<{ id: KakaoFilterTab; label: string }> = [
  { id: 'all', label: '전체' },
  { id: 'sent', label: '보낸 것' },
  { id: 'needs_check', label: '확인 필요' },
  { id: 'held', label: '보내지 않은 것' },
]

/**
 * 최근 건수(최대 50건)에서 상태별 집계 요약을 계산합니다.
 * 비용·크레딧·잔액 등 과금 숫자는 담지 않습니다.
 */
export function computeKakaoSummaryCounts(items: KakaoHistoryItem[]): KakaoSummaryCounts {
  let delivered = 0
  let sent = 0
  let needsCheck = 0
  let held = 0
  let cancelled = 0

  for (const item of items) {
    switch (item.status) {
      case 'DELIVERED':
        delivered += 1
        break
      case 'SENT':
      case 'SENDING':
      case 'SCHEDULED':
        sent += 1
        break
      case 'NEEDS_CHECK':
      case 'FAILED':
        needsCheck += 1
        break
      case 'HELD':
        held += 1
        break
      case 'CANCELLED':
        cancelled += 1
        break
    }
  }

  return {
    delivered,
    sent,
    needsCheck,
    held,
    cancelled,
    total: items.length,
  }
}

/**
 * 선택한 탭에 따라 발송 항목을 필터링합니다.
 */
export function filterKakaoHistoryItems(
  items: KakaoHistoryItem[],
  tab: KakaoFilterTab,
): KakaoHistoryItem[] {
  if (tab === 'all') return items

  switch (tab) {
    case 'sent':
      return items.filter(i =>
        i.status === 'DELIVERED' ||
        i.status === 'SENT' ||
        i.status === 'SENDING' ||
        i.status === 'SCHEDULED'
      )
    case 'needs_check':
      return items.filter(i =>
        i.status === 'NEEDS_CHECK' ||
        i.status === 'FAILED'
      )
    case 'held':
      return items.filter(i =>
        i.status === 'HELD' ||
        i.status === 'CANCELLED'
      )
    default:
      return items
  }
}
