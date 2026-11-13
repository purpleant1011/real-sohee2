import { describe, expect, it, vi } from 'vitest'
import { pgClient, query } from './pg-client'

const workspaceId = 'd1111111-1111-4111-8111-111111111111'
const userId = 'd2222222-2222-4222-8222-222222222222'
const contentId = 'd3333333-3333-4333-8333-333333333333'
const versionId = 'd4444444-4444-4444-8444-444444444444'
const client = pgClient()
const mocks = vi.hoisted(() => ({ preview: vi.fn() }))
vi.mock('@/features/approvals/approval-preview-repository', () => ({ getApprovalPreview: mocks.preview }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({ ...client, auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) } }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: () => client }))
import { approveAndDispatchAction } from '../../../src/features/approvals/actions/approve-and-dispatch'

/** Real server action + PostgreSQL read model; only the unrelated content preview is substituted. */
describe('ANI-1532 dispatch with zero verified channels', () => {
  it('rejects both immediate publish and schedule with connection copy before writing any dispatch request', async () => {
    query(`with u as (insert into auth.users(id) values ('${userId}') returning id) select id from u`)
    query(`with w as (insert into workspaces(id,name,created_by) values ('${workspaceId}','새 서비스','${userId}') returning id) select id from w`)
    mocks.preview.mockResolvedValue({ data: {
      workspaceId, contentId, versionId, fingerprint: 'a'.repeat(64), channel: 'threads',
      account: { connectionId: null, label: null, status: 'disconnected' },
      issues: [{ code: 'channel_disconnected', message: '공식 채널을 다시 연결한 뒤 게시할 수 있어요.' }],
    } })
    for (const mode of ['publish_now', 'schedule'] as const) {
      const result = await approveAndDispatchAction({ workspaceId, contentId, versionId, fingerprint: 'a'.repeat(64), mode,
        channelConnectionId: null, scheduledLocal: mode === 'schedule' ? '2030-01-01T12:00' : null,
        timezone: mode === 'schedule' ? 'Asia/Seoul' : null })
      expect(result.error?.message).toContain('채널을 연결하면 발행할 수 있어요')
    }
    expect(query<{ n: number }>(`select count(*)::int as n from external_action_requests where workspace_id='${workspaceId}'`)[0].n).toBe(0)
  })
})
