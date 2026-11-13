import { describe, expect, it } from 'vitest'
import { pgClient, query } from './pg-client'
import { ensureQuickPostVaultVersions, getQuickPostApprovalOptions } from '../../../src/features/quick-start/quick-post-vault-contract'
import { readQuickPostApprovalReadiness } from '../../../src/features/quick-start/quick-post-approval-readiness'
import { SupabaseVaultSaveRepository } from '../../../src/features/vault/model/supabase-save-repository'
import { saveToVault } from '../../../src/features/vault/service/save'
import { recordFunnelEvent } from '../../../src/features/quick-start/funnel-events'
import { evaluateReadiness } from '../../../src/features/readiness'
import { getSoheeReadiness } from '../../../src/features/sohee-ready/read-model'

const workspaceId = 'a5111111-1111-4111-8111-111111111111'
const userId = 'a5222222-2222-4222-8222-222222222222'
const missionId = 'a5333333-3333-4333-8333-333333333333'
const client = pgClient()

/** Isolated PostgreSQL 16. No provider request, no image, no credential or production database. */
describe('ANI-1548 first-value path in temporary PostgreSQL', () => {
  it('starts with signup, creates a channel-free text version, previews and stores exactly one first event per milestone', async () => {
    query(`with u as (insert into auth.users(id) values ('${userId}') returning id) select id from u`)
    query(`with w as (insert into workspaces(id,name,created_by) values ('${workspaceId}','모모 카페','${userId}') returning id) select id from w`)
    query(`with p as (insert into business_profiles(workspace_id,business_name,industry,summary) values ('${workspaceId}','모모 카페','카페','동네 카페') returning workspace_id) select workspace_id from p`)
    const snapshot = await getSoheeReadiness(workspaceId, { fixtureState: {
      BUSINESS_VERIFIED: false, INSTAGRAM_VERIFIED: false, THREADS_VERIFIED: false,
      BUSINESS_KNOWLEDGE_CONFIRMED: true, TEXT_HARNESS_CONFIRMED: true, IMAGE_HARNESS_CONFIRMED: true, OPERATING_POLICY_CONFIRMED: true,
    } })
    const readiness = evaluateReadiness(snapshot)
    expect(readiness.stage).toBe('PREPARE_ONLY')
    const metadata = { lane: 'QUICK_POST', quick: { revision: 1, topic: '첫 인사', createdBy: userId }, payload: { copies: { instagram: { caption: '첫 인사', hashtags: [] }, threads: { content: '모모 카페에서 첫 인사를 전해요.' } }, imageIds: [], channels: [] } }
    query(`with m as (insert into marketing_missions(id,workspace_id,trace_id,status,goal,metadata) values ('${missionId}','${workspaceId}','first-value-test','AWAITING_APPROVAL','첫 인사','${JSON.stringify(metadata)}'::jsonb) returning id) select id from m`)
    await recordFunnelEvent({ admin: client as never, workspaceId, userId, event: 'signup_completed', dedupeKey: `signup_completed:${userId}` })
    // The shared fake client cannot encode text[]; mirror the merged contract test's adapter.
    const draftClient = { from(table: string) {
      const builder = client.from(table)
      if (table !== 'content_versions') return builder
      return { ...builder, upsert(row: Record<string, unknown>, options: { onConflict: string; ignoreDuplicates: boolean }) { return builder.upsert({ ...row, hashtags: '{}' }, options) } }
    } } as any
    await ensureQuickPostVaultVersions(draftClient, workspaceId, userId, missionId)
    const options = await getQuickPostApprovalOptions(client, workspaceId, missionId, await readQuickPostApprovalReadiness(client, workspaceId))
    const binding = options.targets.find(t => t.channel === 'threads')!
    expect(binding.actions.VAULT.allowed).toBe(true)
    expect(query<{ caption: string }>(`select caption from content_versions where workspace_id='${workspaceId}' and id='${binding.versionId}'`)[0].caption).toBe('모모 카페에서 첫 인사를 전해요.')
    await recordFunnelEvent({ admin: client as never, workspaceId, userId, event: 'preview_viewed', dedupeKey: `preview_viewed:${userId}:${missionId}:1` })
    const recordEvent = async ({ event, dedupeKey }: { event: 'vault.saved' | 'vault.save_failed'; dedupeKey: string }) => {
      await recordFunnelEvent({ admin: client as never, workspaceId, userId, event, dedupeKey })
    }
    const input = { contentId: binding.contentId, versionId: binding.versionId, workspaceId, actorId: userId, channels: ['threads'], targetDate: null, idempotencyKey: 'first-value-save' }
    const first = await saveToVault(input, { repository: new SupabaseVaultSaveRepository(client as never), recordEvent })
    expect(first.saved).toHaveLength(1)
    expect(first.external_posts).toBe(0)
    const repeated = await saveToVault(input, { repository: new SupabaseVaultSaveRepository(client as never), recordEvent })
    expect(repeated.saved).toHaveLength(1)
    await recordFunnelEvent({ admin: client as never, workspaceId, userId, event: 'signup_completed', dedupeKey: `signup_completed:${userId}` })
    await recordFunnelEvent({ admin: client as never, workspaceId, userId, event: 'preview_viewed', dedupeKey: `preview_viewed:${userId}:${missionId}:1` })
    const events = query<{ event: string; occurred_at: string }>(`select event, occurred_at from funnel_events where workspace_id='${workspaceId}' order by occurred_at,id`)
    expect(events.map(row => row.event)).toEqual(['signup_completed', 'preview_viewed', 'vault.saved'])
    expect(events.map(row => Date.parse(row.occurred_at))).toEqual([...events.map(row => Date.parse(row.occurred_at))].sort((a,b) => a-b))
    expect(query<{ n: number }>(`select count(*)::int as n from external_action_requests where workspace_id='${workspaceId}'`)[0].n).toBe(0)
  })
})
