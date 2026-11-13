import { describe, expect, it } from 'vitest'
import { advanceDemo, resetDemo } from './demo-machine'

describe('demo machine', () => {
  it('advances the initial step by one', () => {
    expect(advanceDemo(0)).toBe(1)
  })

  it('keeps the completed step at the five-step boundary', () => {
    expect(advanceDemo(5)).toBe(5)
  })

  it('returns to the first step when reset', () => {
    expect(resetDemo()).toBe(0)
  })
})
