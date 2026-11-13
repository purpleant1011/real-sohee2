import 'server-only'

import { cookies } from 'next/headers'

const REVIEW_COOKIE_NAME = 'sohee_admin_review_pass'
const REVIEW_PASS_DURATION_SECONDS = 0

// Historical preview sessions cannot authorize operator access.
export function isReviewModeAllowed(): boolean {
  return false
}

export async function isReviewPassActive(): Promise<boolean> {
  return false
}

export async function setReviewPassCookie(): Promise<boolean> {
  return false
}

export async function clearReviewPassCookie(): Promise<void> {
  try {
    const cookieStore = await cookies()
    cookieStore.delete(REVIEW_COOKIE_NAME)
  } catch {
    // Ignore cookie cleanup when no writable request context exists.
  }
}

export { REVIEW_COOKIE_NAME, REVIEW_PASS_DURATION_SECONDS }
