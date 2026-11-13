import 'server-only'

import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import { env } from '@/lib/env'
import { getCookieDomain, getSharedCookieOptions } from './cookie-domain'
import type { Database } from './database.types'

export async function createServerSupabaseClient() {
  let cookieStore: any
  try {
    cookieStore = await cookies()
  } catch {
    // Fallback when called outside of request context (e.g. CLI, tests, cron workers)
    cookieStore = {
      getAll: () => [],
      set: () => {},
    }
  }

  let requestHost: string | null = null
  try {
    const requestHeaders = await headers()
    requestHost = requestHeaders.get('host')
  } catch {
    // Fallback when called outside of request context
  }

  const cookieDomain = getCookieDomain(requestHost)

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: cookieDomain
        ? {
            domain: cookieDomain,
            path: '/',
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
          }
        : undefined,
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              const sharedOptions = getSharedCookieOptions(options, requestHost)
              cookieStore.set(name, value, sharedOptions)
            })
          } catch {
            // Server Components cannot set cookies; middleware.ts refreshes the session instead.
          }
        },
      },
    },
  )
}

