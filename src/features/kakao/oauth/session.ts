import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

export interface KakaoAuthProfile {
  readonly id: number
  readonly email?: string
  readonly nickname?: string
  readonly avatarUrl?: string
}

export function isKakaoIdentityMatch(user: User, kakaoId: number | string): boolean {
  const kakaoIdStr = String(kakaoId)
  if (Array.isArray(user.identities)) {
    const matched = user.identities.some(
      (id: any) =>
        id.provider === 'kakao' &&
        (String(id.id) === kakaoIdStr || String(id.identity_data?.sub) === kakaoIdStr),
    )
    if (matched) return true
  }

  const appMeta = user.app_metadata as Record<string, unknown> | undefined
  // user_metadata 는 사용자가 직접 수정할 수 있으므로 신원 판정에 쓰지 않는다(계정 혼동 방지).
  // GoTrue 는 createUser 시 app_metadata.provider 를 'email' 로 덮어쓰므로 provider 값은 신뢰하지 않고,
  // 서비스 롤만 쓸 수 있는 app_metadata.kakao_id 로만 판정한다.
  if (appMeta?.kakao_id !== undefined && String(appMeta.kakao_id) === kakaoIdStr) {
    return true
  }

  return false
}

export type ResolveKakaoUserResult =
  | { readonly ok: true; readonly user: User; readonly isNew: boolean }
  | {
      readonly ok: false
      readonly reason: 'account_linking_prohibited' | 'user_creation_failed'
    }

/**
 * 카카오 프로필을 바탕으로 Supabase 사용자를 해결한다:
 * 1. createUser 시도 (신규 카카오 계정 생성 시 isNew: true)
 * 2. email_exists 에러 발생 시 generateLink 로 기존 사용자를 조회:
 *    - 카카오 신원이 일치하면 해당 사용자 반환 (isNew: false)
 *    - 카카오 신원이 아니면 동일 이메일 타 가입 계정이므로 병합 금지 거부 (account_linking_prohibited)
 * 3. 기타 createUser 에러 또는 조회 실패 시 user_creation_failed 반환
 */
export async function resolveKakaoUser(
  adminClient: any,
  profile: KakaoAuthProfile,
): Promise<ResolveKakaoUserResult> {
  const kakaoIdStr = String(profile.id)
  const profileEmail = profile.email?.trim()
  const userEmail = profileEmail || `kakao_${kakaoIdStr}@kakao.internal`

  // 1. adminClient.auth.admin.createUser 먼저 시도
  const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
    email: userEmail,
    email_confirm: true,
    user_metadata: {
      kakao_id: kakaoIdStr,
      name: profile.nickname || '카카오 사용자',
      nickname: profile.nickname || '카카오 사용자',
      avatar_url: profile.avatarUrl,
    },
    app_metadata: {
      provider: 'kakao',
      providers: ['kakao'],
      kakao_id: kakaoIdStr,
    },
  })

  // 신규 계정 생성 성공
  if (!createError && createData?.user) {
    return { ok: true, user: createData.user, isNew: true }
  }

  // 2. email_exists 에러 확인
  const isEmailExists =
    createError?.code === 'email_exists' ||
    (typeof createError?.message === 'string' &&
      createError.message.includes('already been registered'))

  if (isEmailExists) {
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email: userEmail,
    })

    const existingUser = linkData?.user as User | undefined

    if (linkError || !existingUser) {
      console.error('[kakao/session] generateLink for existing user failed')
      return { ok: false, reason: 'user_creation_failed' }
    }

    if (isKakaoIdentityMatch(existingUser, kakaoIdStr)) {
      return { ok: true, user: existingUser, isNew: false }
    }

    return { ok: false, reason: 'account_linking_prohibited' }
  }

  // 3. 그 외 createUser 에러는 user_creation_failed (비밀·토큰 로그 금지)
  console.error('[kakao/session] createUser error:', createError?.message ?? 'unknown')
  return { ok: false, reason: 'user_creation_failed' }
}

export type IssueSessionResult =
  | { readonly ok: true; readonly session: any; readonly user: User }
  | { readonly ok: false; readonly reason: string }

/**
 * Supabase Admin generateLink와 Server Supabase Client verifyOtp를 통해
 * 카카오 사용자에 대한 세션을 생성하고 쿠키를 설정한다.
 */
export async function issueKakaoSupabaseSession(
  adminClient: any,
  serverSupabase: SupabaseClient<Database>,
  user: User,
): Promise<IssueSessionResult> {
  const userEmail = user.email

  if (!userEmail) {
    return { ok: false, reason: 'missing_user_email' }
  }

  // 1. 매직링크 토큰 생성
  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email: userEmail,
  })

  const tokenHash = (linkData as any)?.properties?.hashed_token

  if (linkError || !tokenHash) {
    console.error('[kakao/session] generateLink error:', linkError)
    return { ok: false, reason: 'generate_link_failed' }
  }

  // 2. serverSupabase의 verifyOtp를 호출하여 세션 발급 및 쿠키 저장
  const { data: sessionData, error: verifyError } = await serverSupabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  })

  if (verifyError || !sessionData?.session) {
    console.error('[kakao/session] verifyOtp error:', verifyError)
    return { ok: false, reason: 'verify_otp_failed' }
  }

  return {
    ok: true,
    session: sessionData.session,
    user: (sessionData.user as User) ?? user,
  }
}
