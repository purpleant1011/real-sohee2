import { cookies } from 'next/headers'
import { LEGACY_OPERATOR_COOKIE_NAME } from './legacy-cookie-name'

// Cleanup only: never inspect this cookie or use it for authorization.
export async function clearLegacyOperatorCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(LEGACY_OPERATOR_COOKIE_NAME)
}
