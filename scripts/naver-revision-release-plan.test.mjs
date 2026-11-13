import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { buildNaverRevisionPlan, NAVER_REVISION_FILES } from './naver-revision-release-plan.mjs'

describe('Naver revision release plan (no apply capability)', () => {
  it('pins only the three commands and readiness probe without applying SQL', () => {
    const before = readFileSync('supabase/migrations-manifest.json', 'utf8')
    const result = buildNaverRevisionPlan(process.cwd())
    expect(result.requiresExplicitApproval).toBe(true)
    expect(result.automaticApply).toBe(false)
    expect(result.migrations.map(row => row.file)).toEqual([
      '20261028160000_naver_block_revision.sql', '20261028170000_naver_version_restore.sql',
      '20261028180000_naver_title_tags_revision.sql', '20261029130000_naver_revision_readiness.sql',
    ])
    expect(result.migrations.every(row => /^[a-f0-9]{64}$/.test(row.sha256))).toBe(true)
    expect(result.planSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(readFileSync('supabase/migrations-manifest.json', 'utf8')).toBe(before)
  })

  it('rejects a changed migration rather than repairing its manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'sohee-naver-plan-'))
    try {
      mkdirSync(join(root, 'supabase/migrations'), { recursive: true })
      copyFileSync('supabase/migrations-manifest.json', join(root, 'supabase/migrations-manifest.json'))
      for (const name of NAVER_REVISION_FILES) copyFileSync(join('supabase/migrations', name), join(root, 'supabase/migrations', name))
      writeFileSync(join(root, 'supabase/migrations', NAVER_REVISION_FILES[0]), '-- altered command')
      expect(() => buildNaverRevisionPlan(root)).toThrow('NAVER_REVISION_MANIFEST_MISMATCH')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('has no executable apply or repair mode', () => {
    const result = spawnSync(process.execPath, ['scripts/naver-revision-release-plan.mjs', 'apply'], { encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('NAVER_REVISION_PLAN_ONLY')
  })
})
