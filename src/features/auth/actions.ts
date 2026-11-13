'use server'

import type { ActionResult } from '../../lib/errors/result'
import { createServerSupabaseClient } from '../../lib/supabase/server'
import { safeAuthNextPath } from './safe-auth-next-path'
import {
  passwordResetRequestSchema,
  passwordUpdateSchema,
  signInSchema,
  signUpSchema,
} from './schemas'
import { clearLegacyOperatorCookie } from '../operator-auth/legacy-cookie'

const requestId = 'auth'

function logSignIn(outcome: 'succeeded' | 'rejected' | 'unavailable'): void {
  console.info('[sohee:auth-sign-in]', { outcome, requestId })
}

function failure<T>(message: string): ActionResult<T> {
  return { error: { message, requestId } }
}

function invalidInput<T>(): ActionResult<T> {
  return failure('입력 내용을 확인해 주세요.')
}

function passwordResetRedirectTo(): string {
  const fallbackOrigin = 'http://localhost:3000'

  try {
    const configuredUrl = new URL(process.env.APP_URL ?? fallbackOrigin)
    if (configuredUrl.protocol !== 'http:' && configuredUrl.protocol !== 'https:') {
      return `${fallbackOrigin}/auth/callback?next=/reset-password`
    }

    return `${configuredUrl.origin}/auth/callback?next=/reset-password`
  } catch {
    return `${fallbackOrigin}/auth/callback?next=/reset-password`
  }
}

function emailSignupRedirectTo(): string {
  const fallbackOrigin = 'http://localhost:3000'

  try {
    const configuredUrl = new URL(process.env.APP_URL ?? fallbackOrigin)
    if (configuredUrl.protocol !== 'http:' && configuredUrl.protocol !== 'https:') {
      return `${fallbackOrigin}/auth/callback?next=/start`
    }

    return `${configuredUrl.origin}/auth/callback?next=/start`
  } catch {
    return `${fallbackOrigin}/auth/callback?next=/start`
  }
}

export async function signInAction(input: unknown): Promise<ActionResult<{ next: string }>> {
  const parsed = signInSchema.safeParse(input)
  if (!parsed.success) return invalidInput()

  try {
    const supabase = await createServerSupabaseClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    })

    if (error) {
      logSignIn('rejected')
      return failure('이메일 또는 비밀번호를 확인해 주세요.')
    }

    logSignIn('succeeded')
    return { data: { next: safeAuthNextPath(parsed.data.next) } }
  } catch {
    logSignIn('unavailable')
    return failure('로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
}

export async function signUpAction(
  input: unknown,
): Promise<ActionResult<{ message: string }>> {
  const parsed = signUpSchema.safeParse(input)
  if (!parsed.success) return invalidInput()

  try {
    const supabase = await createServerSupabaseClient()
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: emailSignupRedirectTo(),
        data: {
          signup_consent: {
            terms_version: parsed.data.termsVersion,
            privacy_version: parsed.data.privacyVersion,
            marketing_consent: parsed.data.marketingConsent,
          },
        },
      },
    })

    if (error) return failure('회원가입을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.')

    return { data: { message: '회원가입 안내를 이메일로 보냈습니다.' } }
  } catch {
    return failure('회원가입을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
}

export async function requestPasswordResetAction(
  input: unknown,
): Promise<ActionResult<{ message: string }>> {
  const parsed = passwordResetRequestSchema.safeParse(input)
  if (!parsed.success) return invalidInput()

  try {
    const supabase = await createServerSupabaseClient()
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: passwordResetRedirectTo(),
    })

    if (error) {
      return failure('비밀번호 재설정 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }

    return { data: { message: '비밀번호 재설정 안내를 이메일로 보냈습니다.' } }
  } catch {
    return failure('비밀번호 재설정 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
}

export async function updatePasswordAction(
  input: unknown,
): Promise<ActionResult<{ message: string }>> {
  const parsed = passwordUpdateSchema.safeParse(input)
  if (!parsed.success) return invalidInput()

  try {
    const supabase = await createServerSupabaseClient()
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password })

    if (error) return failure('비밀번호를 변경하지 못했습니다. 다시 시도해 주세요.')

    return { data: { message: '비밀번호를 변경했습니다. 새 비밀번호로 로그인해 주세요.' } }
  } catch {
    return failure('비밀번호를 변경하지 못했습니다. 다시 시도해 주세요.')
  }
}

export async function signOutAction(): Promise<ActionResult<null>> {
  try {
    await clearLegacyOperatorCookie()
    const supabase = await createServerSupabaseClient()
    const { error } = await supabase.auth.signOut()

    if (error) return failure('로그아웃을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.')

    return { data: null }
  } catch {
    return failure('로그아웃을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
}
