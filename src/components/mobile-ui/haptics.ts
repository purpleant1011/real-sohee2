/** "햅틱 느낌" 피드백. Android는 짧은 진동, iOS Safari는 미지원이므로 시각 눌림(.m-press)만 남는다. 모션 줄이기 설정이면 무동작. */
export function softTap(kind: 'tap' | 'confirm' | 'warn' = 'tap'): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  navigator.vibrate(kind === 'tap' ? 8 : kind === 'confirm' ? [10, 40, 14] : [20, 30, 20])
}
