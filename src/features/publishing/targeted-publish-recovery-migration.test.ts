import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('recovers only one authorized expired publish attempt for reconciliation', () => {
  const sql = readFileSync(join(
    process.cwd(),
    'supabase/migrations/20260822183631_targeted_publish_lease_recovery.sql',
  ), 'utf8')

  expect(sql).toContain('(select auth.uid()) <> p_user_id')
  expect(sql).toContain('not private.is_workspace_member(p_workspace_id)')
  expect(sql).toContain('and id = p_attempt_id')
  expect(sql).toContain("and status = 'pending'")
  expect(sql).toContain('and lease_expires_at < p_now')
  expect(sql).toContain("recovery_status = 'reconcile_required'")
  expect(sql).toContain("set status = 'unknown'")
})
