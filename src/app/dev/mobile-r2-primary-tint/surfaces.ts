/**
 * ANI-1666 프리뷰 표면 식별자 — 서버 컴포넌트(page.tsx)와 클라이언트 프리뷰가 함께 쓴다.
 * 'use client' 모듈에서 내보낸 함수는 서버에서 호출할 수 없어 별도 모듈로 분리한다.
 */
export const SURFACES = ['mission', 'inbox', 'dm'] as const

export type PrimaryTintSurface = (typeof SURFACES)[number]

export function isPrimaryTintSurface(value: string): value is PrimaryTintSurface | 'all' {
  return value === 'all' || (SURFACES as readonly string[]).includes(value)
}
