import type { KakaoHistoryItem } from './contract'

/**
 * 알림톡 발송내역 목록에서 reservationId별 최신 항목을 매핑합니다.
 *
 * - reservationId가 없는 항목은 제외합니다.
 * - 동일 예약에 여러 발송내역이 있을 경우, 가장 최신 시각(updatedAt ?? dueAt)의 항목을 선택합니다.
 */
export function getLatestKakaoByReservation(
  items: readonly KakaoHistoryItem[],
): Map<string, KakaoHistoryItem> {
  const map = new Map<string, KakaoHistoryItem>()
  for (const item of items) {
    if (!item.reservationId) continue
    const existing = map.get(item.reservationId)
    if (!existing) {
      map.set(item.reservationId, item)
      continue
    }
    const existingTime = Date.parse(existing.updatedAt || existing.dueAt) || 0
    const itemTime = Date.parse(item.updatedAt || item.dueAt) || 0
    if (itemTime >= existingTime) {
      map.set(item.reservationId, item)
    }
  }
  return map
}

export const latestKakaoByReservation = getLatestKakaoByReservation
export const mapLatestKakaoByReservation = getLatestKakaoByReservation
