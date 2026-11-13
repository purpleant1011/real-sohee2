/**
 * 카카오 소셜 로그인 노출 스위치.
 * 2026-11-05 결정: 소희는 카카오 소셜 로그인을 사용하지 않는다(알림톡·채널 연동과 별개).
 * 코드는 보존하되 KAKAO_LOGIN_ENABLED === 'true' 일 때만 버튼과 라우트가 살아난다(기본 꺼짐, fail-closed).
 */
export function isKakaoLoginEnabled(env: Record<string, string | undefined>): boolean {
  return env.KAKAO_LOGIN_ENABLED === 'true'
}
