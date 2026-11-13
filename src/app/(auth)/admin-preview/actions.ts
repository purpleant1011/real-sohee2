'use server'

import { redirect } from 'next/navigation'
import { setReviewPassCookie, clearReviewPassCookie, isReviewPassActive, isReviewModeAllowed } from '@/features/operator-auth/review-mode'

export type ReviewAuthResult = {
  success: boolean
  error?: string
  redirectUrl?: string
}

async function hashSha256(str: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Pre-authorized review account digests (Strictly audited: SHA-256 hashes only)
const AUTHORIZED_REVIEW_DIGESTS = [
  {
    emailHash: '23a02382a2ac56ed6f1109f57b98e85466da382983780d7eb0f034ce27cbddbe',
    passHash: '7478ab30b466fb54a282cc849d4f1095731ac0d42edd18f441cbc0db60dfd595',
  },
]

export async function loginWithReviewCredentials(formData: FormData): Promise<ReviewAuthResult> {
  // Fail-Closed Guard (ANI-725): Completely disabled in unauthorized environments
  if (!isReviewModeAllowed()) {
    return {
      success: false,
      error: '검수 모드가 허용되지 않은 환경입니다.',
    }
  }

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    return { success: false, error: '이메일을 입력해 주세요.' }
  }

  if (!password || typeof password !== 'string' || password.length === 0) {
    return { success: false, error: '비밀번호를 입력해 주세요.' }
  }

  try {
    const trimmedEmail = email.trim().toLowerCase()
    const inputEmailHash = await hashSha256(trimmedEmail)
    const inputPassHash = await hashSha256(password)

    const isMatch = AUTHORIZED_REVIEW_DIGESTS.some(
      (h) => h.emailHash === inputEmailHash && h.passHash === inputPassHash,
    )

    // Ordinary user credentials can NEVER be escalated to review pass (ANI-725 fix)
    if (!isMatch) {
      return {
        success: false,
        error: '아이디 또는 비밀번호가 일치하지 않습니다.',
      }
    }

    // Successfully verified! Set review pass cookie for verified review session
    const ok = await setReviewPassCookie()
    if (!ok) {
      return {
        success: false,
        error: '검수 세션 구성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      }
    }
    return { success: true, redirectUrl: '/admin' }
  } catch {
    return {
      success: false,
      error: '로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    }
  }
}

export async function exitReviewMode(): Promise<void> {
  await clearReviewPassCookie()
  redirect('/admin-login')
}

export async function checkReviewModeStatus(): Promise<boolean> {
  return await isReviewPassActive()
}
