import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationDir = join(process.cwd(), 'supabase', 'migrations')
const advisorFile = join(migrationDir, '20260810083250_v07_advisor_foreign_key_indexes.sql')

const relations = [
  'customer_conversations',
  'harness_rules',
  'knowledge_candidates',
  'knowledge_facts',
  'knowledge_sources',
  'messages',
  'work_items',
] as const

const indexNames = [
  'customer_conversations_created_by_idx',
  'harness_rules_approved_by_idx',
  'harness_rules_created_by_idx',
  'knowledge_candidates_conflict_fact_idx',
  'knowledge_candidates_created_by_idx',
  'knowledge_candidates_reviewed_by_idx',
  'knowledge_facts_approved_by_idx',
  'knowledge_sources_created_by_idx',
  'messages_created_by_idx',
  'messages_reply_to_idx',
  'work_items_created_by_idx',
  'work_items_owner_user_idx',
  'work_items_source_thread_message_idx',
] as const

describe('V0.7 advisor index migration compatibility', () => {
  it('guards relations that are created by later migrations', () => {
    const migration = readFileSync(advisorFile, 'utf8')

    for (const relation of relations) {
      expect(migration).toContain(`to_regclass('public.${relation}')`)
    }
  })

  it('repairs every deferred index after the target tables exist', () => {
    const repairFile = readdirSync(migrationDir).find((name) =>
      name.endsWith('_v08_repair_v07_advisor_index_order.sql'),
    )
    expect(repairFile).toBeDefined()

    const migration = readFileSync(join(migrationDir, repairFile!), 'utf8')
    for (const indexName of indexNames) {
      expect(migration).toContain(`create index if not exists ${indexName}`)
    }
  })

  it('defers the authenticated message column grant until messages exists', () => {
    const earlyGrant = readFileSync(
      join(migrationDir, '20260810083558_v07_authenticated_message_persistence.sql'),
      'utf8',
    )
    const repairFile = readdirSync(migrationDir).find((name) =>
      name.endsWith('_v08_repair_v07_advisor_index_order.sql'),
    )
    expect(repairFile).toBeDefined()

    const repair = readFileSync(join(migrationDir, repairFile!), 'utf8')
    expect(earlyGrant).toContain("to_regclass('public.messages')")
    expect(repair).toContain(
      'grant insert (completed_at) on public.messages to authenticated',
    )
  })

  it('allows the historical Byreum recovery to be a no-op on a fresh database', () => {
    const recovery = readFileSync(
      join(migrationDir, '20260814155900_recover_safe_byreum_pending_attempts.sql'),
      'utf8',
    )

    expect(recovery).toContain('if recovered not in (0, 2) then')
  })
})
