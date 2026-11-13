import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildReleaseApplySql, loadReleaseMigrations, releasePlanDigest } from './sns-release-database-gate.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const literal = value => `'${value.replaceAll("'", "''")}'`
export function pinnedSourceFiles() {
  return [
    'scripts/sns-release-database-gate.mjs',
    'scripts/mission-database-gate.mjs',
    'scripts/local-public-env.mjs',
    'supabase/migrations/20261027110000_ani1877_mission_contract_hardening.sql',
    ...loadReleaseMigrations().map(row => `supabase/migrations/${row.version}_${row.name}.sql`),
  ]
}

// This is an explicitly approved operator transport, not a CI impersonation or a new plan.
// The reviewed SQL is unchanged except for psql's client-only conditional statements.
export function buildSqlEditorRelease(approval, readApprovedFile) {
  const { approvedSha, approvedPlan, currentMainSha, confirmation } = approval
  if (!/^[a-f0-9]{40}$/.test(approvedSha || '') || currentMainSha !== approvedSha
      || approvedPlan !== releasePlanDigest() || confirmation !== 'apply-sns-release') {
    throw new Error('SNS_RELEASE_APPROVAL_REQUIRED')
  }
  for (const file of pinnedSourceFiles()) {
    if (readApprovedFile(file) !== readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')) {
      throw new Error('SNS_RELEASE_SOURCE_DRIFT')
    }
  }
  let sql = buildReleaseApplySql()
  for (const row of loadReleaseMigrations()) {
    const insert = `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (${literal(row.version)},${literal(row.name)},ARRAY[${literal(row.sql)}]);`
    const original = `SELECT NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${literal(row.version)}) AS pending \\gset\n\\if :pending\n${row.sql}\n${insert}\n\\endif`
    if (sql.split(original).length !== 2 || row.sql.includes('$sns_editor$')) throw new Error('SNS_RELEASE_TRANSPORT_DRIFT')
    sql = sql.replace(original, () => `DO $sns_editor$ BEGIN\nIF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${literal(row.version)}) THEN\nEXECUTE ${literal(row.sql)};\n${insert}\nEND IF;\nEND $sns_editor$;`)
  }
  if (/\\gset|\\if|\\endif/.test(sql)) throw new Error('SNS_RELEASE_TRANSPORT_DRIFT')
  return { approvedSha, plan: approvedPlan, sql, sqlDigest: createHash('sha256').update(sql).digest('hex') }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [approvedSha, approvedPlan, confirmation, output] = process.argv.slice(2)
    if (!output?.startsWith('/')) throw new Error('SNS_RELEASE_OUTPUT_REQUIRED')
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30_000 }).trim()
    const currentMainSha = git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0]
    const release = buildSqlEditorRelease({ approvedSha, approvedPlan, currentMainSha, confirmation }, file =>
      execFileSync('git', ['show', `${approvedSha}:${file}`], { cwd: root, encoding: 'utf8' }))
    writeFileSync(output, release.sql, { flag: 'wx', mode: 0o600 })
    console.log(JSON.stringify({ approvedSha, plan: release.plan, sqlDigest: release.sqlDigest, output }))
  } catch {
    console.error('SNS_RELEASE_SQL_EDITOR_BLOCKED')
    process.exitCode = 1
  }
}
