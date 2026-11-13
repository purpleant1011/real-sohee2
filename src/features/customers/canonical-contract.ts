export interface CanonicalCustomerItem {
  id: string
  displayName: string
  phoneMasked: string | null
  reservationCount: number
  lastBookingStartsAt: string | null
  conversationCount?: number
  lastConversationAt?: string | null
}

export interface CanonicalCustomersResponse {
  ok: boolean
  items: CanonicalCustomerItem[]
}

/**
 * E.164 형식(+8210XXXXXXXX)의 전화번호를 '010-****-XXXX' 형태로 마스킹합니다.
 * 전체 전화번호 및 SHA-256 해시 등의 PII 노출을 차단합니다.
 */
export function maskPhoneE164(phoneE164: string | null | undefined): string | null {
  if (!phoneE164) return null
  const cleaned = phoneE164.trim()
  const match = cleaned.match(/^\+8210\d{4}(\d{4})$/)
  if (match) {
    return `010-****-${match[1]}`
  }
  if (cleaned.startsWith('+8210') && cleaned.length >= 11) {
    const last4 = cleaned.slice(-4)
    if (/^\d{4}$/.test(last4)) {
      return `010-****-${last4}`
    }
  }
  return null
}
