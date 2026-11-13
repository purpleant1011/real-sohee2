import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * 스키마–코드 드리프트 게이트(scripts/verify-schema-code-drift.mjs) 자체 테스트.
 *
 * 게이트가 "조용히 통과만 하는" 상태가 되지 않도록, baseline 에서 항목 하나를 빼면
 * 실제로 실패(exit 1)하는지 확인한다. 네트워크·외부 DB 없이 정적 파싱만 돈다.
 */

const SCRIPT = path.join(process.cwd(), 'scripts', 'verify-schema-code-drift.mjs')
const BASELINE = path.join(process.cwd(), 'scripts', 'schema-code-drift-baseline.json')

function runGate(args = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'test' },
  })
}

// 게이트는 3,500여 파일을 정적 스캔하므로 1회 2~8초 걸린다. 기본 5초로는 부족하다.
const GATE_TIMEOUT_MS = 120_000

describe('verify-schema-code-drift 게이트', () => {
  it('baseline 대로면 통과하고, baseline 에서 항목을 빼면 실패한다', () => {
    const pass = runGate()
    expect(pass.status, `gate stderr:\n${pass.stderr}`).toBe(0)
    expect(pass.stdout).toContain('PASS')

    const tempDir = mkdtempSync(path.join(tmpdir(), 'drift-baseline-'))
    try {
      const reduced = path.join(tempDir, 'baseline.json')
      const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
      // 마지막 항목을 baseline 에서 제거 → 그 드리프트는 "새 드리프트"로 판정되어야 한다.
      expect(baseline.known.length).toBeGreaterThan(0)
      baseline.known.pop()
      writeFileSync(reduced, JSON.stringify(baseline))

      const fail = runGate(['--baseline', reduced])
      expect(fail.status, `gate stdout:\n${fail.stdout}`).toBe(1)
      expect(fail.stderr).toContain('새 스키마–코드 드리프트')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  }, GATE_TIMEOUT_MS)

  it('--report 는 항상 exit 0 이고 현재 드리프트 목록을 출력한다', () => {
    const report = runGate(['--report'])
    expect(report.status, `gate stderr:\n${report.stderr}`).toBe(0)
    expect(report.stdout).toContain('알려진 드리프트(baseline)')
    expect(report.stdout).toMatch(/마이그레이션 \d+개 · 코드 \d+파일/)
  }, GATE_TIMEOUT_MS)
})
