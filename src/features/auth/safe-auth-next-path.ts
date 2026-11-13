import { safeNextPath } from './safe-next-path'
import { safeOperatorNextPath } from './safe-operator-next-path'

function isOperatorPathCandidate(input: unknown): input is string {
  return typeof input === 'string' && /^\/(?:admin|operator)(?:[/?#]|$)/u.test(input)
}

export function safeAuthNextPath(input: unknown): string {
  if (input === '/auth/admin-setup') return '/auth/admin-setup'
  return isOperatorPathCandidate(input) ? safeOperatorNextPath(input) : safeNextPath(input)
}
