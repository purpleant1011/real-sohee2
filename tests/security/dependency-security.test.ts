// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')) as {
  packages: Record<string, { version?: string }>
}

function versions(name: string) {
  return Object.entries(lock.packages)
    .filter(([path]) => path.endsWith(`/node_modules/${name}`) || path === `node_modules/${name}`)
    .map(([, entry]) => entry.version!)
}

function atLeast(version: string, minimum: string) {
  const actual = version.split('.').map(Number)
  const required = minimum.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (actual[i] !== required[i]) return actual[i] > required[i]
  }
  return !version.includes('-')
}

// Lockfile regression guards for the 2026-11-03 audit, not exploit reproductions.
// Runtime compatibility is covered separately by the application suite and builds.
describe('security dependency floors', () => {
  it.each([
    ['next', '16.4.1'],
    ['vitest', '4.1.12'],
    ['@vitest/mocker', '4.1.12'],
    ['vite', '6.4.5'],
    ['proxy-addr', '2.0.8'],
    ['body-parser', '2.4.0'],
    ['js-yaml', '4.3.2'],
    ['source-map-js', '1.2.2'],
    ['sharp', '0.35.5'],
    ['undici', '7.30.1'],
    ['zod', '4.6.6'],
  ])('%s stays outside the audited vulnerable range', (name, floor) => {
    const installed = versions(name)
    expect(installed.length).toBeGreaterThan(0)
    for (const version of installed) expect({ name, version, safe: atLeast(version, floor) }).toMatchObject({ safe: true })
  })

  it('does not retain a vulnerable tinypool after the runner migration', () => {
    for (const version of versions('tinypool')) expect(atLeast(version, '2.1.2')).toBe(true)
  })

  it('uses the patched brace-expansion release for each supported major', () => {
    const floors: Record<string, string> = { '1': '1.1.21', '2': '2.1.7', '3': '3.0.1', '5': '5.0.12' }
    for (const version of versions('brace-expansion')) {
      const floor = floors[version.split('.')[0]]
      expect({ version, safe: !!floor && atLeast(version, floor) }).toMatchObject({ safe: true })
    }
  })
})
