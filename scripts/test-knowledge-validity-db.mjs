import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const connection = process.env.SOHEE_KNOWLEDGE_TEST_DB_URL
if (!connection) throw new Error('SOHEE_KNOWLEDGE_TEST_DB_URL must name a new disposable loopback database')
const url = new URL(connection)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/sohee_w8_test')) {
  throw new Error('Only disposable loopback sohee_w8_test databases are permitted')
}
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const studio = read('supabase/migrations/20261016090509_sohee_studio_production.sql')
const start = studio.indexOf('create or replace function public.decide_studio_proposal(')
const end = studio.indexOf('-- 8. DB RPC', start)
if (start < 0 || end < 0) throw new Error('Existing Studio RPC extraction failed')
const migrationPath = 'supabase/migrations/20261022080100_studio_fact_validity.sql'
const migration = existsSync(new URL(`../${migrationPath}`, import.meta.url)) ? read(migrationPath) : ''
const input = ['\\set ON_ERROR_STOP on', 'begin;', read('tests/integration/knowledge-validity/fixture.sql'),
  studio.slice(start, end), migration, read('tests/integration/knowledge-validity/assertions.sql'), 'rollback;'].join('\n')
const result = spawnSync(process.env.PSQL_BIN || 'psql', [connection, '-X', '-q'], { input, encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'] })
if (result.error) throw result.error
process.exit(result.status ?? 1)
