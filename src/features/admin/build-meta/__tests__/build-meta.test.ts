import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { UNKNOWN_VERSION_LABEL, formatBuildLabel, formatShortVersion, getBuildMeta, parseBuildMeta } from '../build-meta'
import generated from '@/generated/build-meta.json'

const root = join(__dirname, '../../../../..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('ANI-1565 build meta', () => {
  it('shows the unknown label, never a made-up version, when metadata is missing or malformed', () => {
    expect(parseBuildMeta(undefined)).toEqual({ version: null, sha: null })
    expect(parseBuildMeta({ version: 'latest', sha: 'zzz' })).toEqual({ version: null, sha: null })
    expect(formatBuildLabel({ version: null, sha: null })).toBe(UNKNOWN_VERSION_LABEL)
    expect(formatShortVersion({ version: null, sha: null })).toBe(UNKNOWN_VERSION_LABEL)
  })

  it('formats version and short SHA from build metadata', () => {
    const meta = parseBuildMeta({ version: '1.2.3', sha: 'ABCDEF0123456789' })
    expect(formatBuildLabel(meta)).toBe('v1.2.3 · abcdef0')
    expect(formatShortVersion(meta)).toBe('v1.2.3')
  })

  it('getBuildMeta reflects exactly the generated file', () => {
    expect(getBuildMeta()).toEqual(parseBuildMeta(generated))
  })

  it('has no hard-coded version labels in admin screens', () => {
    const dirs = ['src/app/admin', 'src/components/admin', 'src/components/operator-shell', 'src/features/admin']
    const offenders = dirs
      .flatMap((dir) => sourceFiles(join(root, dir)))
      .filter((file) => readFileSync(file, 'utf8').split('\n').some((line) => {
        const code = line.trim()
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*') || code.startsWith('{/*')) return false
        return /['"`>\s]V0\.\d+(\.\d+)?|v0\.\d+\.\d+-prod/.test(code)
      }))
    expect(offenders).toEqual([])
  })
})
