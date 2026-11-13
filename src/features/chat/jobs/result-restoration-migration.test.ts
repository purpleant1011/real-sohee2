import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260822181516_v08_restore_ready_artifact_results.sql',
)

describe('ready artifact result restoration migration', () => {
  it('restores only complete reviewable artifacts and reconciles their reservation', () => {
    const migration = readFileSync(migrationPath, 'utf8')

    expect(migration).toContain("job.status = 'needs_attention'")
    expect(migration).toContain("artifact.status <> 'ready_for_review'")
    expect(migration).toContain("slide.status <> 'succeeded'")
    expect(migration).toContain('public.settle_credit_reservation')
    expect(migration).toContain('public.release_credit_reservation')
  })

  it('restores the assistant result and resolves existing and future attention rows', () => {
    const migration = readFileSync(migrationPath, 'utf8')

    expect(migration).toContain("set status = 'completed'")
    expect(migration).toContain("attention_resolution = 'result_restored'")
    expect(migration).toContain('after update of status on public.conversation_jobs')
    expect(migration).toContain('select private.restore_ready_conversation_job_results()')
  })
})
