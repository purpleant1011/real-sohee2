import 'server-only'

import { createClient } from '@supabase/supabase-js'
import { SUPABASE_PROJECT_URL } from '@/lib/env'
import type { Database } from './database.types'
import { parseServiceRoleKey } from './service-role-key'

export function createAdminSupabaseClient() {
  return createClient<Database>(
    SUPABASE_PROJECT_URL,
    parseServiceRoleKey(process.env.SUPABASE_SERVICE_ROLE_KEY),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  )
}
