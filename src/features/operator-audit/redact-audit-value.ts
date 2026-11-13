export const MAX_AUDIT_DEPTH = 6
export const MAX_AUDIT_OBJECT_KEYS = 64
export const MAX_AUDIT_ARRAY_ITEMS = 64
export const MAX_AUDIT_STRING_LENGTH = 2000
export const MAX_AUDIT_BYTES = 16000

const REDACTED = '[REDACTED]'
const REDACTED_ERROR = '[REDACTED_ERROR]'
const LIMIT_EXCEEDED = '[LIMIT_EXCEEDED]'
const UNAVAILABLE = '[UNAVAILABLE]'

const sensitiveKeys = new Set([
  'password',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'cookie',
  'authorization',
  'invitelink',
  'recoverycode',
  'exactpayload',
  'providerbody',
])

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, '')
}

function sensitiveString(value: string): boolean {
  return /\bbearer\s+\S+/iu.test(value)
    || /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u.test(value)
    || /https?:\/\/[^\s/:]+:[^\s/@]+@/iu.test(value)
    || /https?:\/\/\S+(?:access[_-]?token|refresh[_-]?token|secret|password|invite[_-]?link|recovery[_-]?code)=/iu.test(value)
    || /\b(?:sk-[A-Za-z0-9_-]{8,}|sb_secret_[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_-]+|xoxb-[A-Za-z0-9_-]+)\b/iu.test(value)
    || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)
}

function sanitize(value: unknown, depth: number, ancestors: WeakSet<object>): unknown {
  if (depth > MAX_AUDIT_DEPTH) return LIMIT_EXCEEDED
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : UNAVAILABLE
  if (typeof value === 'string') {
    if (value.length > MAX_AUDIT_STRING_LENGTH) return LIMIT_EXCEEDED
    return sensitiveString(value) ? REDACTED : value
  }
  if (typeof value !== 'object') return UNAVAILABLE
  if (value instanceof Error) return REDACTED_ERROR
  if (ancestors.has(value)) return UNAVAILABLE

  if (Array.isArray(value)) {
    if (value.length > MAX_AUDIT_ARRAY_ITEMS) return LIMIT_EXCEEDED
    ancestors.add(value)
    try {
      return value.map((item) => sanitize(item, depth + 1, ancestors))
    } catch {
      return UNAVAILABLE
    } finally {
      ancestors.delete(value)
    }
  }

  let prototype: object | null
  let keys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return UNAVAILABLE
  }
  if (prototype !== Object.prototype && prototype !== null) return UNAVAILABLE
  if (keys.length > MAX_AUDIT_OBJECT_KEYS) return LIMIT_EXCEEDED
  if (keys.some((key) => typeof key !== 'string')) return UNAVAILABLE

  ancestors.add(value)
  const result: Record<string, unknown> = {}
  try {
    for (const key of keys as readonly string[]) {
      if (sensitiveKeys.has(normalizedKey(key))) {
        result[key] = REDACTED
        continue
      }

      let descriptor: PropertyDescriptor | undefined
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key)
      } catch {
        return UNAVAILABLE
      }
      if (!descriptor || !('value' in descriptor)) {
        result[key] = UNAVAILABLE
        continue
      }
      result[key] = sanitize(descriptor.value, depth + 1, ancestors)
    }
    return result
  } finally {
    ancestors.delete(value)
  }
}

export function redactAuditValue(value: unknown): unknown {
  const redacted = sanitize(value, 0, new WeakSet())
  try {
    const serialized = JSON.stringify(redacted)
    if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > MAX_AUDIT_BYTES) {
      return LIMIT_EXCEEDED
    }
    return redacted
  } catch {
    return UNAVAILABLE
  }
}
