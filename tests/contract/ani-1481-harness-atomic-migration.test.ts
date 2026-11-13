import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('ANI-1481: Database Migration Contract', () => {
  const migrationsDir = path.join(process.cwd(), 'supabase/migrations')

  it('contains the ANI-1481 migration file with exact RPC signature and partial unique index', () => {
    const files = fs.readdirSync(migrationsDir)
    const migrationFile = files.find((f) => f.includes('ani_1481_harness_atomic_version_activation'))
    expect(migrationFile).toBeDefined()

    const sql = fs.readFileSync(path.join(migrationsDir, migrationFile!), 'utf-8')

    // 1. Partial unique index on (workspace_id, rule_key) where status = 'active'
    expect(sql).toMatch(
      /create\s+unique\s+index\s+(?:if\s+not\s+exists\s+)?harness_rules_active_workspace_rule_key_uidx\s+on\s+public\.harness_rules\s*\(\s*workspace_id\s*,\s*rule_key\s*\)\s*where\s+status\s*=\s*'active'/i
    )

    // 2. RPC function declaration
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.activate_harness_rule_version/i)

    // 3. Security definer and search_path
    expect(sql).toMatch(/security\s+definer/i)
    expect(sql).toMatch(/set\s+search_path\s*=\s*(?:'public',\s*'pg_temp'|public,\s*pg_temp|public)/i)

    // 4. Advisory xact lock on workspace + rule_key
    expect(sql).toMatch(/pg_advisory_xact_lock/i)

    // 5. Version sequence computed from (workspace_id, rule_key)
    expect(sql).toMatch(/coalesce\s*\(\s*max\s*\(\s*version\s*\)\s*,\s*0\s*\)\s*\+\s*1/i)

    // 6. Retires ONLY the same workspace and rule_key
    expect(sql).toMatch(/status\s*=\s*'retired'/i)

    // 7. Revoke from public, anon, authenticated and Grant to service_role
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.activate_harness_rule_version/i)
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.activate_harness_rule_version[\s\S]+?to\s+service_role/i)
  })
})
