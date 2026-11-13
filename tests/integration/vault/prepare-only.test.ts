import { describe, expect, it, vi } from 'vitest'
import { pgClient, query } from './pg-client'
import { SupabaseVaultSaveRepository } from '../../../src/features/vault/model/supabase-save-repository'
import { saveToVault } from '../../../src/features/vault/service/save'
import { evaluateGate } from '../../../src/features/readiness'
import { loadReadiness } from '../../../src/features/readiness/load'
import { calculateApprovalFingerprint } from '../../../src/features/missions/conversational-first-post'
import { literal } from './pg-client'

const ws = 'c1111111-1111-4111-8111-111111111111'
const user = 'c2222222-2222-4222-8222-222222222222'
const content = 'c3333333-3333-4333-8333-333333333333'
const version = 'c4444444-4444-4444-8444-444444444444'
const client = pgClient()

const mocks = vi.hoisted(() => ({ createServer: vi.fn(), createAdmin: vi.fn(), compose: vi.fn(), loadReadiness: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: mocks.createServer }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: mocks.createAdmin }))
vi.mock('@/features/missions/conversational-first-post', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), composeFirstPostWithGemini: mocks.compose }))
vi.mock('@/features/readiness/load', () => ({ loadReadiness: mocks.loadReadiness }))
import { POST as propose } from '../../../src/app/api/missions/first-post/propose/route'
import { POST as publish } from '../../../src/app/api/missions/first-post/publish/route'

/** HTTP request handlers + DB persistence; only auth and paid LLM are substituted. */
describe('ANI-1532 zero-channel PREPARE_ONLY server flow', () => {
  it('proposes on the server, persists the mission and vault row, refuses publish and schedule with user copy', async () => {
    query(`with u as (insert into auth.users(id) values ('${user}') returning id) select id from u`)
    query(`with w as (insert into workspaces(id,name,created_by) values ('${ws}', '새로운 서비스', '${user}') returning id) select id from w`)
    query(`with h as (insert into workspace_knowledge_harnesses(harness_version_id,workspace_id,version_no,offerings,policies) values ('prepare-only-v1','${ws}',1,'[{"key":"service","value":"예약 상담"}]','[]') returning harness_version_id) select harness_version_id from h`)
    const rule = (ruleType: string, structured: object) => query(`with r as (insert into harness_rules(workspace_id,rule_key,rule_type,title,structured_rule,status,approved_by_user_id,approved_at,created_by_user_id) values ('${ws}','${ruleType.replaceAll('_','-')}','${ruleType}','준비 완료','${JSON.stringify(structured).replaceAll("'", "''")}'::jsonb,'active','${user}',now(),'${user}') returning id) select id from r`)
    rule('text_generation', { brandVoice: '친절한', rules: { brandVoice: '친절한' } })
    rule('image_generation', { goldenImageIds: ['a', 'b', 'c'], rules: { rightsStatus: 'OWNED', consentStatus: 'CONFIRMED' } })
    rule('approval_policy', { publishApprovalLevel: 'MANUAL' })
    query(`with c as (insert into content_items(id,workspace_id,channel,title,created_by) values ('${content}','${ws}','threads','새 서비스 소식','${user}') returning id) select id from c`)
    query(`with v as (insert into content_versions(id,workspace_id,content_id,version_number,caption,fingerprint,created_by) values ('${version}','${ws}','${content}',1,'새로운 서비스가 곧 시작됩니다.','${'b'.repeat(64)}','${user}') returning id) select id from v`)
    const readiness = { stage: 'PREPARE_ONLY' as const, prepared: true, verifiedChannels: [] as ('instagram' | 'threads')[], businessVerified: false, progressPercent: 75, connectionHint: '채널을 연결하면 발행할 수 있어요', trialAutoPublishEnabled: false as const, facts: Object.fromEntries(['BUSINESS_KNOWLEDGE_CONFIRMED','TEXT_HARNESS_CONFIRMED','IMAGE_HARNESS_CONFIRMED','OPERATING_POLICY_CONFIRMED'].map(key => [key, { verified: true }])), blockers: [] }
    expect(query<{ status: string }>(`select status from workspace_members where workspace_id='${ws}' and user_id='${user}'`)[0].status).toBe('active')
    mocks.createServer.mockResolvedValue({ ...client, auth: { getUser: async () => ({ data: { user: { id: user, email: 'user@example.invalid' } } }) } })
    mocks.createAdmin.mockReturnValue(client)
    mocks.loadReadiness.mockResolvedValue(readiness)
    mocks.compose.mockResolvedValue({ instagram: { caption: '안녕하세요' }, threads: { content: '안녕하세요' } })
    const response = await propose(new Request('http://localhost/api/missions/first-post/propose', { method: 'POST', headers: { 'x-workspace-id': ws }, body: JSON.stringify({ utterance: '서비스 첫 인사' }) }))
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200)
    const payload = await response.json()
    expect(payload.draft.channels).toEqual([])
    expect(query<{ status: string }>(`select status from marketing_missions where id='${payload.draft.missionId}'`)[0].status).toBe('AWAITING_APPROVAL')
    const vault = await saveToVault({ workspaceId: ws, actorId: user, contentId: content, versionId: version, channels: ['threads'], targetDate: null, idempotencyKey: 'prepare-only' }, { repository: new SupabaseVaultSaveRepository(client as never) })
    expect(vault.saved).toHaveLength(1)
    expect(vault.saved[0].release_gate_label).toContain('채널 연결')
    expect(query<{ n: number }>(`select count(*)::int as n from vault_items where workspace_id='${ws}'`)[0].n).toBe(1)
    const actualReadiness = await loadReadiness(ws, { supabaseClient: client as never, adminClient: client as never })
    const publishVerdict = evaluateGate(actualReadiness, 'PUBLISH')
    const scheduleVerdict = evaluateGate(actualReadiness, 'SCHEDULE')
    expect(publishVerdict).toMatchObject({ allowed: false, message: '채널을 연결하면 발행할 수 있어요' })
    expect(scheduleVerdict).toMatchObject({ allowed: false, message: '채널을 연결하면 발행할 수 있어요' })
    const persisted = query<{ metadata: { payload: import('../../../src/features/missions/conversational-first-post').ExactApprovalPayload } }>(`select metadata from marketing_missions where id='${payload.draft.missionId}'`)[0]
    const approvedPayload = persisted.metadata.payload
    const approvedFingerprint = calculateApprovalFingerprint(approvedPayload)
    const metadata = { ...persisted.metadata, approvedMission: { missionId: payload.draft.missionId, approvedFingerprint } }
    query(`with approved as (update marketing_missions set status='APPROVED', metadata=${literal(metadata)}::jsonb where id='${payload.draft.missionId}' returning id) select id from approved`)
    expect(query<{ status: string }>(`select status from marketing_missions where id='${payload.draft.missionId}'`)[0].status).toBe('APPROVED')
    const post = await publish(new Request('http://localhost/api/missions/first-post/publish', { method: 'POST', headers: { 'x-workspace-id': ws }, body: JSON.stringify({ missionId: payload.draft.missionId }) }))
    expect(post.status).toBe(403)
    expect((await post.json()).error).toContain('채널을 연결하면 발행할 수 있어요')
    expect(query<{ n: number }>(`select count(*)::int as n from external_action_requests where workspace_id='${ws}'`)[0].n).toBe(0)
  })
})
