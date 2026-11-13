/** Customer 360 masking: secrets, tokens and personal data never reach the admin DOM. */
const REDACTED = '[가림]'
const SECRET_KEY = /(password|passwd|secret|token|cookie|authorization|api[_-]?key|credential|session|recovery|invite|signature|signed|exact_?payload|provider_?body)/i
const PII_KEY = /(^|_)(email|phone|mobile|tel|address|birth|ssn|rrn|business_?number|representative)(_|$)/i

export function maskEmail(value: string): string {
  const at = value.indexOf('@')
  if (at < 1) return REDACTED
  return `${value[0]}***@${value.slice(at + 1)}`
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  return digits.length < 8 ? REDACTED : `${digits.slice(0, 3)}-****-${digits.slice(-4)}`
}

export function maskName(value: string): string {
  const chars = [...value.trim()]
  if (chars.length <= 1) return REDACTED
  if (chars.length === 2) return `${chars[0]}*`
  return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars.at(-1)}`
}

/** Mask secrets/PII embedded in free text. Idempotent. */
export function maskText(input: string): string {
  return input
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, REDACTED)
    .replace(/\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\b(?:sb_secret|ghp|gho|xox[bap]|AIzaSy|EAA)[A-Za-z0-9_-]{8,}/g, REDACTED)
    .replace(/([?&](?:access_?token|refresh_?token|token|signature|sig|key|secret|code|password)=)[^&\s]+/gi, `$1${REDACTED}`)
    .replace(/https?:\/\/[^\s/:@]+:[^\s/@]+@/gi, 'https://')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, m => maskEmail(m))
    .replace(/\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/g, m => maskPhone(m))
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, REDACTED)
}

/** Deep mask by key name and string content. Depth and width are bounded. */
export function maskDeep(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return maskText(value)
  if (depth > 5) return REDACTED
  if (Array.isArray(value)) return value.slice(0, 50).map(v => maskDeep(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) || PII_KEY.test(k) ? REDACTED : maskDeep(v, depth + 1)
    }
    return out
  }
  return REDACTED
}

/** Short, masked one-line summary of a jsonb detail object. */
export function summarizeMasked(value: unknown, limit = 160): string {
  const masked = maskDeep(value)
  if (masked === null || masked === undefined) return ''
  const text = typeof masked === 'string' ? masked : JSON.stringify(masked)
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}
