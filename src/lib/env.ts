import { z } from 'zod'

export const SUPABASE_PROJECT_REF = 'your-project-ref'
export const SUPABASE_PROJECT_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`
export const LOCAL_E2E_FLAG = 'SOHEE_LOCAL_E2E'
export const LOCAL_E2E_PUBLIC_FLAG = 'NEXT_PUBLIC_SOHEE_LOCAL_E2E'
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function isLoopbackSupabaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
  } catch {
    return false
  }
}

export function isLocalE2EEnabled(): boolean {
  const flagEnabled =
    process.env.SOHEE_LOCAL_E2E === '1' ||
    process.env.NEXT_PUBLIC_SOHEE_LOCAL_E2E === '1'
  if (!flagEnabled) return false
  if (process.env.NODE_ENV === 'production') return false
  if (process.env.CF_PAGES || process.env.WORKERS_CI) return false
  return true
}

export function createPublicEnvSchema() {
  return z.object({
    NEXT_PUBLIC_SUPABASE_URL: z
      .string()
      .url()
      .refine(
        (value) =>
          value === SUPABASE_PROJECT_URL ||
          (isLocalE2EEnabled() && isLoopbackSupabaseUrl(value)),
        '승인된 Supabase 프로젝트가 아닙니다',
      ),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
      .string()
      .regex(
        /^sb_publishable_[A-Za-z0-9._-]+$/,
        '공개용 Supabase publishable key만 사용할 수 있습니다',
      ),
  })
}

export type PublicEnv = z.infer<ReturnType<typeof createPublicEnvSchema>>

export class PublicEnvConfigurationError extends Error {
  readonly code = 'PUBLIC_ENV_UNAVAILABLE'

  constructor() {
    super('공개 서비스 설정을 준비하지 못했습니다.')
    this.name = 'PublicEnvConfigurationError'
  }
}

export function parsePublicEnv(input: Record<string, string | undefined>): PublicEnv {
  return createPublicEnvSchema().parse(input)
}

export function readPublicEnv(
  input?: Record<string, string | undefined>,
): PublicEnv {
  const result = createPublicEnvSchema().safeParse(
    input ?? {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    },
  )

  if (!result.success) {
    throw new PublicEnvConfigurationError()
  }

  return result.data
}

export const env: PublicEnv = {
  get NEXT_PUBLIC_SUPABASE_URL() {
    return readPublicEnv().NEXT_PUBLIC_SUPABASE_URL
  },
  get NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY() {
    return readPublicEnv().NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  },
}
