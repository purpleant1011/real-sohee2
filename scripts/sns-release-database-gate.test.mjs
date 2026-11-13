// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as gate from './sns-release-database-gate.mjs'
const { buildReadinessMigration, releaseContract, verifyReadiness } = gate

describe('SNS forward-only deployment plan', () => {
  it('pins only four forward revisions without scanning or repairing historical versions', () => {
    expect(gate.loadReleaseMigrations).toBeTypeOf('function')
    expect(gate.loadReleaseMigrations().map(row => row.version)).toEqual([
      '20261027200000', '20261027210000', '20261027215000', '20261027220000',
    ])
  })
  it('applies missing revisions and verifies readiness in one locked transaction', () => {
    expect(gate.buildReleaseApplySql).toBeTypeOf('function')
    const sql = gate.buildReleaseApplySql()
    expect(sql).toMatch(/^BEGIN;/)
    expect(sql).toContain('pg_advisory_xact_lock(17761877)')
    expect(sql).toContain('SNS_RELEASE_HISTORY_DRIFT')
    expect(sql).toContain('sns_release_readiness()')
    expect(sql.trim()).toMatch(/COMMIT;$/)
    expect(sql).not.toMatch(/DELETE FROM supabase_migrations|UPDATE supabase_migrations/i)
  })
  it('requires exact main SHA and plan approval inside CI', () => {
    expect(gate.validateReleaseApproval).toBeTypeOf('function')
    expect(() => gate.validateReleaseApproval({})).toThrow('SNS_RELEASE_APPROVAL_REQUIRED')
    const env = { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40), SNS_APPROVED_SHA: 'a'.repeat(40), SNS_APPROVED_PLAN: gate.releasePlanDigest(), SNS_RELEASE_CONFIRMATION: 'apply-sns-release' }
    expect(() => gate.validateReleaseApproval(env)).not.toThrow()
    expect(() => gate.validateReleaseApproval({ ...env, SNS_APPROVED_PLAN: 'stale' })).toThrow('SNS_RELEASE_APPROVAL_REQUIRED')
  })
})

// The release check must fail closed on an absent/stale contract, even with HTTP 200.
describe('SNS release database readiness', () => {
  it('accepts only the exact live schema contract', async () => {
    const fetcher = async () => ({ ok: true, json: async () => ({ ready: true, contract: releaseContract }) })
    await expect(verifyReadiness('https://example.supabase.co', 'public-key', fetcher)).resolves.toBeUndefined()
  })
  it.each([
    { ready: false, contract: releaseContract },
    { ready: true, contract: 'old-contract' },
    null,
    { ready: true },
  ])('rejects missing or stale database readiness %#', async body => {
    const fetcher = async () => ({ ok: true, json: async () => body })
    await expect(verifyReadiness('https://example.supabase.co', 'public-key', fetcher)).rejects.toThrow('SNS_DATABASE_NOT_READY')
  })
  it('rejects unavailable RPCs rather than treating connectivity as readiness', async () => {
    await expect(verifyReadiness('https://example.supabase.co', 'public-key', async () => ({ ok: false }))).rejects.toThrow('SNS_DATABASE_NOT_READY')
  })
  it('ships exactly the generated read-only catalog/ACL check, with no customer data projection', () => {
    const sql = buildReadinessMigration()
    expect(readFileSync(new URL('../supabase/migrations/20261027220000_sns_release_readiness.sql', import.meta.url), 'utf8')).toBe(sql)
    expect(sql).toContain('RPC_CONTRACT_OR_PRIVILEGE_DRIFT')
    expect(sql).toContain('claim_first_post_publish')
    expect(sql).toContain('TENANT_FOREIGN_KEY_REQUIRED')
    expect(sql).toContain('PUBLISH_CONSUMPTION_RLS_REQUIRED')
    expect(sql).toContain('STABLE SECURITY DEFINER')
    expect(sql).toContain("RETURN jsonb_build_object('ready',false)")
    expect(sql).not.toContain('RETURN QUERY')
  })
})
