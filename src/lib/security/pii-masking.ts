/**
 * [ANI-467][J05] PII Masking & Sensitive Data Protection Utility
 * Masks phone numbers, resident numbers, account numbers, and credit cards from evidence & logs.
 */

export class PiiMaskingService {
  /**
   * Phone number pattern (e.g., 010-1234-5678, 01012345678, 02-123-4567)
   */
  private static PHONE_REGEX = /(\d{2,3})[-.\s]?(\d{3,4})[-.\s]?(\d{4})/g

  /**
   * Korean Resident Registration Number (RRN: 6 digits - 7 digits)
   */
  private static RRN_REGEX = /(\d{6})[-.\s]?([1-4]\d{6})/g

  /**
   * Bank Account number pattern (10~14 digits with optional hyphens)
   */
  private static ACCOUNT_REGEX = /(\d{3,6})[-.\s]?(\d{2,6})[-.\s]?(\d{3,6})/g

  /**
   * Email address pattern
   */
  private static EMAIL_REGEX = /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g

  public static maskText(input: string): string {
    if (!input) return ''

    let masked = input

    // 1. Mask Korean Resident Registration Number: 900101-1******
    masked = masked.replace(this.RRN_REGEX, (_match, p1, _p2) => `${p1}-*******`)

    // 2. Mask Phone Number: 010-****-5678
    masked = masked.replace(this.PHONE_REGEX, (_match, p1, _p2, p3) => `${p1}-****-${p3}`)

    // 3. Mask Email: j***@domain.com
    masked = masked.replace(this.EMAIL_REGEX, (_match, user, domain) => {
      const maskedUser = user.length > 2 ? `${user[0]}${'*'.repeat(user.length - 2)}${user[user.length - 1]}` : `${user[0]}*`
      return `${maskedUser}@${domain}`
    })

    return masked
  }

  public static sanitizeLogPayload<T extends Record<string, any>>(payload: T): T {
    if (!payload || typeof payload !== 'object') return payload

    const cloned = JSON.parse(JSON.stringify(payload))

    const walkAndSanitize = (obj: any) => {
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'string') {
          // Sensitive keys
          if (/password|secret|token|cookie|credential|auth/i.test(key)) {
            obj[key] = '[REDACTED_SECRET]'
          } else {
            obj[key] = this.maskText(obj[key])
          }
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          walkAndSanitize(obj[key])
        }
      }
    }

    walkAndSanitize(cloned)
    return cloned
  }
}
