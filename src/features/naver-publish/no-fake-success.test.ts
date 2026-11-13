import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Built by concatenation so this guard does not match itself.
const FORBIDDEN = [
  'NaverBlog' + 'AutomationService',
  'naver-blog-' + 'publisher',
  'generated' + 'LogNo',
  'writePost' + '.json',
  'naver-live-' + 'post',
]

describe('no fake Naver publish success', () => {
  // Repos on slow external disks may take 10-20s for git grep to scan 2,600+ files.
  it('keeps the simulated publisher and the dead Open API call out of src', () => {
    let offenders: string[] = []

    if (existsSync(join(process.cwd(), '.git'))) {
      try {
        const stdout = execFileSync(
          'git',
          [
            'grep',
            '-l',
            '-F',
            '--untracked',
            ...FORBIDDEN.flatMap((w) => ['-e', w]),
            '--',
            'src',
            ':(exclude)src/features/naver-publish/no-fake-success.test.ts',
          ],
          { cwd: process.cwd(), encoding: 'utf8' }
        )
        offenders = stdout.split(/\r?\n/).filter(Boolean)
      } catch (err: any) {
        if (err?.status !== 1) throw err
      }
    }

    expect(offenders).toEqual([])

    expect(existsSync(join(process.cwd(), 'src/features/marketing-agent/engine/naver-blog-publisher.ts'))).toBe(false)
    expect(existsSync(join(process.cwd(), 'src/app/api/automation/naver-live-post/route.ts'))).toBe(false)
  }, 60_000)
})
