import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const NAVER_REVISION_FILES = Object.freeze([
  '20261028160000_naver_block_revision.sql',
  '20261028170000_naver_version_restore.sql',
  '20261028180000_naver_title_tags_revision.sql',
  '20261029130000_naver_revision_readiness.sql',
])
const sha256 = value => createHash('sha256').update(value).digest('hex')

/** Local inventory only: no credentials, network, database access, or history writes. */
export function buildNaverRevisionPlan(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'supabase/migrations-manifest.json'), 'utf8'))
  const migrations = NAVER_REVISION_FILES.map(file => {
    const bytes = readFileSync(join(root, 'supabase/migrations', file))
    const entries = manifest.migrations.filter(row => row.filename === file)
    const entry = entries[0]
    if (entries.length !== 1 || entry.version !== file.split('_')[0] || entry.checksum !== sha256(bytes) || entry.size !== bytes.length) {
      throw new Error('NAVER_REVISION_MANIFEST_MISMATCH')
    }
    return { file, version: entry.version, bytes: bytes.length, sha256: entry.checksum }
  })
  return {
    contract: 'naver-revision-v1', requiresExplicitApproval: true, automaticApply: false,
    remoteStatus: 'NOT_PROBED', migrations, planSha256: sha256(JSON.stringify(migrations)),
    prerequisites: [
      'Read-only catalog reconciliation of existing helper definitions, grants, table RLS, columns and migration aliases',
      'Isolated complete replay and authenticated tenant/role/collision tests',
      'Explicit approval of these exact bytes and target environment before each missing revision is applied',
      'Post-apply catalog/grants/readiness readback and PostgREST schema reload verification',
    ],
    rollback: 'Disable Naver revision capability; preserve immutable content versions and existing approval/publication records. Do not drop tables or rewrite migration history.',
    exclusions: ['blog_stage_facts', 'repair_mission_source_job_atomic', 'tenant data updates', 'SNS publish', 'main merge', 'app deploy'],
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] && process.argv[2] !== 'plan') throw new Error('NAVER_REVISION_PLAN_ONLY')
    console.log(JSON.stringify(buildNaverRevisionPlan(join(dirname(fileURLToPath(import.meta.url)), '..')), null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'NAVER_REVISION_PLAN_FAILED')
    process.exitCode = 1
  }
}
