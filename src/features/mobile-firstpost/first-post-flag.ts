/**
 * 첫 포스팅 R2 레인 플래그.
 *
 * 서버 컴포넌트(라우트)와 클라이언트 컴포넌트가 같은 판정을 써야 하므로
 * `'use client'` 모듈에 두지 않는다 — 서버 컴포넌트는 클라이언트 모듈의 함수를 부를 수 없다.
 * 기본값은 꺼짐이고 `on` 일 때만 켜진다.
 */
export const FIRST_POST_R2_FLAG = 'NEXT_PUBLIC_MOBILE_R2_FIRSTPOST'

export function isFirstPostR2Enabled(value: string | undefined = process.env.NEXT_PUBLIC_MOBILE_R2_FIRSTPOST): boolean {
  return value === 'on'
}
