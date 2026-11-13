import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261106020000_weekly_allowance_excludes_bonus_grants.sql'), 'utf8')

describe('weekly allowance check ignores bonus grants', () => {
  it('counts only :allowance ledger entries toward the weekly policy', () => {
    const sum = sql.slice(sql.indexOf('select coalesce(sum(amount)'), sql.indexOf('into v_existing_allowance'))
    expect(sum).toMatch(/kind in \('grant', 'adjustment'\)/)
    expect(sum).toContain("idempotency_key like '%:allowance'")
    expect(sum).not.toMatch(/kind = 'grant'\s+or/)
  })

  it('keeps the over-allowance conflict guard and service_role-only access', () => {
    expect(sql).toContain('CREDIT_ENTITLEMENT_PERIOD_CONFLICT')
    expect(sql).toContain('to service_role')
  })
})
