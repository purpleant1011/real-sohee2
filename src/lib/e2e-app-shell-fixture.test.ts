import { describe, expect, it } from 'vitest'
import {
  fixtureAppPath,
  isAppShellFixtureEnabled,
  isLocalFixtureRequestEnabled,
  isLoopbackFixtureHost,
} from './e2e-app-shell-fixture'

describe('isAppShellFixtureEnabled', () => {
  it('keeps the browser fixture unavailable unless its exact test flag is set', () => {
    expect(isAppShellFixtureEnabled(undefined)).toBe(false)
    expect(isAppShellFixtureEnabled('true')).toBe(false)
    expect(isAppShellFixtureEnabled('1')).toBe(true)
  })
})

describe('local fixture request boundary', () => {
  it.each(['127.0.0.1:3100', 'localhost:3100', '[::1]:3100'])('accepts loopback host %s', (host) => {
    expect(isLoopbackFixtureHost(host)).toBe(true)
    expect(isLocalFixtureRequestEnabled('1', host)).toBe(true)
  })

  it.each([undefined, 'example.com', 'www.example.com', '127.0.0.1.example.com'])('rejects non-loopback host %s', (host) => {
    expect(isLoopbackFixtureHost(host)).toBe(false)
    expect(isLocalFixtureRequestEnabled('1', host)).toBe(false)
  })

  it('requires the exact private fixture flag even on loopback', () => {
    expect(isLocalFixtureRequestEnabled(undefined, '127.0.0.1:3100')).toBe(false)
    expect(isLocalFixtureRequestEnabled('true', '127.0.0.1:3100')).toBe(false)
  })
})

describe('fixtureAppPath', () => {
  it('allows only the nested work path needed by the browser fixture', () => {
    expect(fixtureAppPath('work-content')).toBe('/app/work/content-123')
    expect(fixtureAppPath('/app/reports')).toBe('/app')
    expect(fixtureAppPath('toString')).toBe('/app')
  })
})
