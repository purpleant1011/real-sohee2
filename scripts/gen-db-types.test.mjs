import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * database.types.ts 재생성기(scripts/gen-db-types.mjs) 자체 테스트.
 *
 * 타입 파일이 마이그레이션보다 낡으면 코드가 `as any` 로 스키마 드리프트를 가리게 된다.
 * 그래서 "재생 스키마 == 커밋된 타입" 을 게이트로 고정한다. PostgreSQL 16 이 없으면 skip 한다.
 */
const SCRIPT = path.join(process.cwd(), 'scripts', 'gen-db-types.mjs')
const TYPES = path.join(process.cwd(), 'src', 'lib', 'supabase', 'database.types.ts')
const PG_BIN = process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'
const hasPostgres = existsSync(path.join(PG_BIN, 'initdb'))

// 재생 + 타입 생성은 2~3초면 끝나지만 여유를 둔다.
const TIMEOUT_MS = 300_000

describe('gen-db-types 재생성기', () => {
  it.skipIf(!hasPostgres)('커밋된 database.types.ts 가 마이그레이션 재생 스키마와 일치한다', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--check'], {
      encoding: 'utf8',
      cwd: process.cwd(),
      timeout: TIMEOUT_MS - 10_000,
    })
    expect(
      result.status,
      `--check 실패. 갱신: npm run gen:db-types\n${result.stderr || result.stdout}`,
    ).toBe(0)
  }, TIMEOUT_MS)

  it('생성된 타입 파일이 이번 PR 에서 해소한 스키마를 담고 있다', () => {
    const content = readFileSync(TYPES, 'utf8')
    // 이름 불일치 3종이 정본으로 들어왔는지
    expect(content).toContain('engagement_audit: {')
    expect(content).toContain('social_attribution_events: {')
    expect(content).toContain('notifications: {')
    // 없는 테이블 6종
    for (const table of [
      'workspace_onboarding_gates',
      'workspace_onboarding_missions',
      'agent_execution_receipts',
      'agent_energy_reservations',
      'browser_tasks',
      'provider_observed_media',
    ]) {
      expect(content).toContain(`${table}: {`)
    }
    // external_action_receipts 레거시 컬럼
    expect(content).toContain('external_action_receipts: {')
    expect(content).toMatch(/action_kind: string \| null/)
  })
})
