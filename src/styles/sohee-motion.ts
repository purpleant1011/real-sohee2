export const SOHEE_DURATION = {
  fast: 0.14,
  normal: 0.22,
} as const

export const SOHEE_EASING = [0.2, 0.8, 0.2, 1] as const

export const SOHEE_MOTION_PRESETS = {
  // 1. Button tap, segmented pill tab toggle (Snappy)
  snappy: { type: 'spring', stiffness: 450, damping: 35, mass: 1 },
  // 2. Card arrival, slide-over drawer, modal open (Gentle)
  gentle: { type: 'spring', stiffness: 280, damping: 26, mass: 1 },
  // 3. Goal badge, live agent pulse (Playful/Bouncy)
  bouncy: { type: 'spring', stiffness: 500, damping: 18, mass: 0.8 },
} as const

export function soheeMotionTransition(reduced: boolean) {
  return reduced
    ? { duration: 0 }
    : { duration: SOHEE_DURATION.normal, ease: SOHEE_EASING }
}
