import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const script = join(process.cwd(), 'scripts/verify-runtime-truth.mjs')

describe('reporting truth gate regression', () => {
  it.each([
    'const effectiveBookings = confirmedBookingsCount > 0 ? confirmedBookingsCount : 2',
    'const totalRev = rows.reduce((sum, r) => sum + (r.total_amount_krw || r.deposit_krw || 0), 0)',
    'const card = <RoiCalculatorCard hoursSaved={42} costSavedWon={350000} />',
  ])('rejects fabricated reporting calculation: %s', (code) => {
    const root = mkdtempSync(join(tmpdir(), 'sohee-truth-gate-'))
    try {
      mkdirSync(join(root, 'src/features/reporting'), { recursive: true })
      writeFileSync(join(root, 'src/features/reporting/report.tsx'), code)
      const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('NO_FABRICATED_REPORTING_KPI')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
