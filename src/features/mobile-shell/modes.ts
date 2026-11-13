import type { BottomSurface, ModePolicy, ShellMode } from './types'

/**
 * 모드별 전역 표면 계약. 이 표가 유일한 정본이다.
 * - 고정 하단 표면은 tabbar | cta | composer | none 중 하나뿐.
 * - 5탭은 BROWSE 에서만, 단일 CTA 는 DETAIL/REVIEW/EDIT 에서만.
 */
export const MODE_POLICY: Readonly<Record<ShellMode, ModePolicy>> = {
  BROWSE: { header: 'app', tabbar: true, cta: 'forbidden', composer: false },
  DETAIL: { header: 'back', tabbar: false, cta: 'optional', composer: false },
  REVIEW: { header: 'back', tabbar: false, cta: 'required', composer: false },
  CHAT: { header: 'chat', tabbar: false, cta: 'forbidden', composer: true },
  EDIT: { header: 'back', tabbar: false, cta: 'required', composer: false },
}

export function resolveBottomSurface(mode: ShellMode, hasCta: boolean): BottomSurface {
  const policy = MODE_POLICY[mode]
  if (policy.tabbar) return 'tabbar'
  if (policy.composer) return 'composer'
  if (policy.cta !== 'forbidden' && hasCta) return 'cta'
  return 'none'
}
