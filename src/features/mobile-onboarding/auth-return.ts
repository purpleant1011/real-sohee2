import { safeAuthNextPath } from '@/features/auth/safe-auth-next-path'

export type AuthReturn = { path: string; preserveDraft: boolean; message: string | null }

export function resolveAuthReturn(input: { next?: unknown; error?: string | null }): AuthReturn {
  const path = safeAuthNextPath(input.next)
  if (!input.error) return { path, preserveDraft: false, message: null }
  // 복원 범위: 비밀번호를 제외한 입력값. 문구도 이 범위와 일치해야 한다.
  const message =
    input.error === 'access_denied'
      ? '로그인을 취소하셨어요. 입력하신 내용은 그대로 두었어요. 비밀번호만 다시 입력하고 시도해 주세요.'
      : '로그인이 잘 되지 않았어요. 입력하신 내용은 그대로 두었어요. 잠시 후 비밀번호를 다시 입력하고 시도해 주세요.'
  return { path, preserveDraft: true, message }
}
