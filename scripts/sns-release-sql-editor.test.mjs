// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import * as editor from './sns-release-sql-editor.mjs'
import { buildReleaseApplySql, loadReleaseMigrations, releasePlanDigest } from './sns-release-database-gate.mjs'

const sha = '20bcb74ed9fb4eeb01dca1374db4269a32f5b846'
const plan = '2ece3b5d6e9563c45c17775bba58e453b2fb3af95804e7d77e42d6d40f08d7ea'
const approval = { approvedSha: sha, approvedPlan: plan, currentMainSha: sha, confirmation: 'apply-sns-release' }
const readApprovedFile = file => execFileSync('git', ['show', `${sha}:${file}`], { encoding: 'utf8' })

describe('passwordless SQL Editor release transport', () => {
  it('requires every exact approval and unchanged main before producing executable SQL', () => {
    expect(editor.buildSqlEditorRelease).toBeTypeOf('function')
    for (const key of Object.keys(approval)) {
      expect(() => editor.buildSqlEditorRelease({ ...approval, [key]: '' }, readApprovedFile)).toThrow()
    }
    expect(() => editor.buildSqlEditorRelease({ ...approval, currentMainSha: 'a'.repeat(40) }, readApprovedFile)).toThrow()
    expect(() => editor.buildSqlEditorRelease({ ...approval, approvedPlan: 'a'.repeat(64) }, readApprovedFile)).toThrow()
  })
  it('rejects local drift in any pinned source dependency or migration', () => {
    for (const file of editor.pinnedSourceFiles()) {
      expect(() => editor.buildSqlEditorRelease(approval, name => readApprovedFile(name) + (name === file ? '\n-- drift' : ''))).toThrow('SNS_RELEASE_SOURCE_DRIFT')
    }
  })
  it('changes only psql conditional transport, retaining the exact transaction and contract', () => {
    const result = editor.buildSqlEditorRelease(approval, readApprovedFile)
    expect(result.approvedSha).toBe(sha)
    expect(result.plan).toBe(plan)
    expect(result.plan).toBe(releasePlanDigest())
    expect(result.sql).toMatch(/^BEGIN;/)
    expect(result.sql.trim()).toMatch(/COMMIT;$/)
    expect(result.sql).not.toMatch(/\\gset|\\if|\\endif/)
    expect(result.sql).toContain('pg_advisory_xact_lock(17761877)')
    expect(result.sql).toContain('LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE')
    expect(result.sql).toContain('SNS_RELEASE_HISTORY_DRIFT')
    expect(result.sql).toContain('SNS_RELEASE_NOT_READY')
    expect(result.sql).not.toMatch(/(?:DELETE FROM|UPDATE) supabase_migrations/i)
    // Replacing only the reviewed conditional blocks must reproduce the original bytes.
    let restored = result.sql
    for (const row of loadReleaseMigrations()) {
      const literal = value => `'${value.replaceAll("'", "''")}'`
      const block = `DO $sns_editor$ BEGIN\nIF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${literal(row.version)}) THEN\nEXECUTE ${literal(row.sql)};\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (${literal(row.version)},${literal(row.name)},ARRAY[${literal(row.sql)}]);\nEND IF;\nEND $sns_editor$;`
      expect(restored).toContain(block)
      restored = restored.replace(block, () => `SELECT NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${literal(row.version)}) AS pending \\gset\n\\if :pending\n${row.sql}\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (${literal(row.version)},${literal(row.name)},ARRAY[${literal(row.sql)}]);\n\\endif`)
    }
    expect(restored).toBe(buildReleaseApplySql())
    expect(result.sqlDigest).toMatch(/^[a-f0-9]{64}$/)
  })
  it('includes the complete transitive gate input set', () => {
    const files = editor.pinnedSourceFiles()
    expect(files).toContain('scripts/sns-release-database-gate.mjs')
    expect(files).toContain('scripts/mission-database-gate.mjs')
    expect(files).toContain('scripts/local-public-env.mjs')
    for (const row of loadReleaseMigrations()) {
      expect(files).toContain(`supabase/migrations/${row.version}_${row.name}.sql`)
    }
    expect(files).toContain('supabase/migrations/20261027110000_ani1877_mission_contract_hardening.sql')
    for (const file of files) expect(readApprovedFile(file)).toBe(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'))
  })
})
