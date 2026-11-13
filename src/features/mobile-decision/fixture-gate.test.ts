import { expect, it } from 'vitest'
import { allowMobileFixture } from './fixture-gate'
it('never exposes the fixture in production regardless of flag or spoofed loopback host', () => {
  expect(allowMobileFixture('production', '1', 'localhost:3001')).toBe(false)
  expect(allowMobileFixture('development', '1', 'example.com')).toBe(false)
  expect(allowMobileFixture('development', undefined, 'localhost:3001')).toBe(false)
  expect(allowMobileFixture('development', '1', '127.0.0.1:3001')).toBe(true)
})
