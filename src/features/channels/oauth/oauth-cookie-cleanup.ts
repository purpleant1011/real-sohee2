import type { NextResponse } from 'next/server'
import { getCookieDomain } from '@/lib/supabase/cookie-domain'
import type { MetaOAuthChannel } from './meta-oauth'

/** Retire pre-migration host-only cookies without overwriting the shared-domain cookies. */
export function expireLegacyOAuthCookies(response: NextResponse, channel: MetaOAuthChannel, url: URL) {
  if (!getCookieDomain(url.hostname)) return
  const sharedCookies = response.headers.getSetCookie()
  response.headers.delete('set-cookie')
  for (const name of [`sohee_meta_oauth_${channel}`, `sohee_meta_oauth_return_${channel}`]) {
    response.headers.append('set-cookie', `${name}=; Path=/api/channels/${channel}/callback; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${url.protocol === 'https:' ? '; Secure' : ''}`)
  }
  // Keep the shared cookie last for consumers that index cookies by name only.
  for (const cookie of sharedCookies) response.headers.append('set-cookie', cookie)
}
