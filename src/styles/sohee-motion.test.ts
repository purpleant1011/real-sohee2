import { describe, expect, it } from 'vitest'
import { SOHEE_DURATION, SOHEE_MOTION_PRESETS, soheeMotionTransition } from './sohee-motion'

describe('sohee motion', () => {
  it('keeps product transitions brief and disables them for reduced motion', () => {
    expect(SOHEE_DURATION.normal).toBeLessThanOrEqual(0.24)
    expect(soheeMotionTransition(true)).toEqual({ duration: 0 })
  })

  it('provides Emil Kowalski spring motion presets', () => {
    expect(SOHEE_MOTION_PRESETS.snappy).toEqual({ type: 'spring', stiffness: 450, damping: 35, mass: 1 })
    expect(SOHEE_MOTION_PRESETS.gentle).toEqual({ type: 'spring', stiffness: 280, damping: 26, mass: 1 })
    expect(SOHEE_MOTION_PRESETS.bouncy).toEqual({ type: 'spring', stiffness: 500, damping: 18, mass: 0.8 })
  })
})
