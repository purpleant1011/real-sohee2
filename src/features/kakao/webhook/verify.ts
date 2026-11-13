import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Constant-time verification of Kakao Webhook Authorization header.
 * Expected format: `Authorization: KakaoAK ${KAKAO_WEBHOOK_SECRET}`
 */
export function verifyKakaoWebhookAuth(
  authHeader: string | null | undefined,
  expectedSecret: string | null | undefined,
): boolean {
  if (
    !authHeader ||
    !expectedSecret ||
    typeof authHeader !== 'string' ||
    typeof expectedSecret !== 'string'
  ) {
    return false
  }

  const trimmedHeader = authHeader.trim()
  const trimmedSecret = expectedSecret.trim()

  if (trimmedSecret.length === 0) {
    return false
  }

  const match = trimmedHeader.match(/^KakaoAK\s+(.+)$/)
  if (!match) {
    return false
  }

  const token = match[1].trim()
  if (token.length === 0) {
    return false
  }

  // Hash both with SHA-256 to ensure identical buffer length and constant-time comparison
  const hashA = createHash('sha256').update(token, 'utf8').digest()
  const hashB = createHash('sha256').update(trimmedSecret, 'utf8').digest()

  return timingSafeEqual(hashA, hashB)
}
