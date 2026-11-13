import { beforeEach, describe, expect, it } from 'vitest'
import { resolveConversationWorkRef } from './conversation-work-ref'
const ws = '10000000-0000-4000-8000-000000000001', user = '20000000-0000-4000-8000-000000000001'
const version = '30000000-0000-4000-8000-000000000001', content = '40000000-0000-4000-8000-000000000001'
let rows: Record<string, unknown>
function db() { return { from: (table: string) => {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: rows[table], error: null }) }; return query
} } }
beforeEach(() => { rows = {
  workspace_members: { role: 'manager', status: 'active' },
  content_versions: { id: version, workspace_id: ws, content_id: content, version_number: 3, fingerprint: 'a'.repeat(64), caption: '사용자가 저장한 안내 원고' },
  content_items: { id: content, workspace_id: ws, current_version_id: version, title: '우리 가게 원고', channel: 'threads', status: 'draft' },
} })
describe('server-resolved work reference', () => {
  it('resolves the exact current version and derives a direct return link without trusting a client URL', async () => {
    expect(await resolveConversationWorkRef(db(), { workspaceId: ws, userId: user, workRef: version })).toMatchObject({
      contentId: content, versionId: version, versionNumber: 3, readOnly: true, returnHref: `/app/work/${content}`,
    })
  })
  it('rejects another workspace even when an opaque id is known', async () => {
    rows.content_versions = { ...(rows.content_versions as object), workspace_id: 'foreign' }
    expect(await resolveConversationWorkRef(db(), { workspaceId: ws, userId: user, workRef: version })).toBeNull()
  })
  it('rejects a stale version instead of quietly switching to a newer draft', async () => {
    rows.content_items = { ...(rows.content_items as object), current_version_id: user }
    expect(await resolveConversationWorkRef(db(), { workspaceId: ws, userId: user, workRef: version })).toBeNull()
  })
  it('rejects archived work and revoked membership', async () => {
    rows.content_items = { ...(rows.content_items as object), status: 'archived' }
    expect(await resolveConversationWorkRef(db(), { workspaceId: ws, userId: user, workRef: version })).toBeNull()
    rows.workspace_members = null
    expect(await resolveConversationWorkRef(db(), { workspaceId: ws, userId: user, workRef: version })).toBeNull()
  })
})
