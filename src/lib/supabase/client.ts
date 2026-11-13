'use client'

import { createBrowserClient } from '@supabase/ssr'
import { env } from '@/lib/env'
import { getCookieDomain } from './cookie-domain'
import type { Database } from './database.types'

export function createBrowserSupabaseClient() {
  const domain = getCookieDomain()
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    domain
      ? {
          cookieOptions: {
            domain,
            path: '/',
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
          },
        }
      : undefined,
  )
}

