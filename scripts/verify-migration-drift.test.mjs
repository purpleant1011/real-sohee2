// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import * as drift from './verify-migration-drift.mjs'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('supabase/migrations-manifest.json', root), 'utf8'))
const row = { version: '20261027100000', filename: '20261027100000_contract.sql', checksum: 'a'.repeat(64), size: 5 }

describe('immutable local migration inventory', () => {
  it('matches the complete repository without claiming remote readiness or replay', () => {
    const local = drift.loadLocalMigrations(new URL('supabase/migrations', root))
    expect(drift.manifestDifferences(local, manifest)).toEqual([])
    expect(manifest.total_migrations).toBe(local.length)
    expect(manifest.remote_probe_status).toBe('NOT_PROBED')
    expect(manifest.full_replay_status).toBe('NOT_VERIFIED')
  })
  it('rejects timestamp collisions instead of overwriting an inventory entry', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sohee-history-test-'))
    try {
      writeFileSync(join(directory, '20261027100000_one.sql'), 'select 1;')
      writeFileSync(join(directory, '20261027100000_two.sql'), 'select 2;')
      expect(() => drift.loadLocalMigrations(directory)).toThrow('LOCAL_HISTORY_CONFLICT')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it.each([
    ['CHECKSUM_MISMATCH', { ...row, checksum: 'b'.repeat(64) }],
    ['FILENAME_MISMATCH', { ...row, filename: '20261027100000_renamed.sql' }],
    ['SIZE_MISMATCH', { ...row, size: 6 }],
  ])('detects %s even when version is unchanged', (type, entry) => {
    expect(drift.manifestDifferences([row], { migrations: [entry], total_migrations: 1 })).toContainEqual(expect.objectContaining({ type }))
    expect(() => drift.appendManifest([row], { migrations: [entry], total_migrations: 1 })).toThrow('IMMUTABLE_MANIFEST_DRIFT')
  })
  it('refuses duplicate manifest versions, missing files, and count corruption', () => {
    for (const existing of [
      { migrations: [row, row], total_migrations: 2 },
      { migrations: [row, { ...row, version: 'other' }], total_migrations: 2 },
      { migrations: [row], total_migrations: 2 },
    ]) expect(() => drift.appendManifest([row], existing)).toThrow('IMMUTABLE_MANIFEST_DRIFT')
  })
  it('appends new entries without changing a tracked checksum or asserting remote qualification', () => {
    const added = { ...row, version: '20261027100100', filename: '20261027100100_new.sql' }
    const next = drift.appendManifest([row, added], { migrations: [row], total_migrations: 1 })
    expect(next.migrations).toEqual([row, added])
    expect(next.remote_probe_status).toBe('NOT_PROBED')
    expect(next.full_replay_status).toBe('NOT_VERIFIED')
    expect(next.target_supabase_url).toBeNull()
  })
  it('local CLI verifies without credentials, network, or manifest writes', () => {
    const before = readFileSync(new URL('supabase/migrations-manifest.json', root), 'utf8')
    const result = spawnSync(process.execPath, ['scripts/verify-migration-drift.mjs', '--local'], {
      cwd: root, env: { PATH: process.env.PATH, HOME: '/nonexistent' }, encoding: 'utf8',
    })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('NOT_PROBED')
    expect(result.stdout).not.toContain('ALL GATES PASSED')
    expect(readFileSync(new URL('supabase/migrations-manifest.json', root), 'utf8')).toBe(before)
  })
})

describe('remote ledger is not schema application evidence', () => {
  it('marks absent versions as unresolved, never unapplied (a consolidated revision may cover them)', () => {
    expect(drift.remoteDifferences([row], [{ version: '20261027200000', name: 'mission_release_contract' }])).toEqual([
      { type: 'REMOTE_HISTORY_UNRECONCILED', version: row.version, file: row.filename },
    ])
  })
  it('rejects same-version different-name and duplicate remote records', () => {
    expect(drift.remoteDifferences([row], [{ version: row.version, name: 'other' }])[0].type).toBe('REMOTE_NAME_CONFLICT')
    expect(drift.remoteDifferences([row], [{ version: row.version, name: 'contract' }, { version: row.version, name: 'contract' }])[0].type).toBe('REMOTE_VERSION_DUPLICATE')
  })
  it('does not infer aliases from a matching name at a different timestamp', () => {
    expect(drift.remoteDifferences([row], [{ version: '19990101000000', name: 'contract' }])[0].type).toBe('REMOTE_HISTORY_UNRECONCILED')
  })
})
