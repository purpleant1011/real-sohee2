import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { listOperatorDocumentReconsentTargets } from './document-reconsent-repository'

const workspaceId = '41000000-0000-4000-8000-000000000001'
const wire = {
  document_type: 'privacy_consent',
  active_document: { id: '41000000-0000-4000-8000-000000000101', version: 'v2', fingerprint: 'a'.repeat(64), review_status: 'approved', effective_at: '2026-08-20T00:00:00.000Z', expires_at: null },
  state: 'fresh',
  items: [{ workspace_id: workspaceId, workspace_name: '고객사', document_type: 'privacy_consent', channel: null, active_version: 'v2', active_fingerprint: 'a'.repeat(64), prior_accepted_at: '2026-08-19T00:00:00.000Z', reason: 'document_version_outdated' }],
} as const

describe('document reconsent repository', () => {
  it('uses the scoped read RPC and preserves safe reconsent reasons', async () => {
    const rpc = vi.fn(async () => ({ data: wire, error: null }))
    const result = await listOperatorDocumentReconsentTargets('privacy_consent', workspaceId, { gateway: { rpc } })
    expect(result.error).toBeNull()
    expect(result.data?.items[0].reason).toBe('document_version_outdated')
    expect(rpc).toHaveBeenCalledWith('list_operator_document_reconsent_targets', { p_document_type: 'privacy_consent', p_workspace_id: workspaceId, p_limit: 100 })
  })

  it('rejects raw or unknown wire reasons', async () => {
    const result = await listOperatorDocumentReconsentTargets('privacy_consent', undefined, { gateway: { rpc: async () => ({ data: { ...wire, items: [{ ...wire.items[0], reason: 'raw_customer_note' }] }, error: null }) } })
    expect(result).toEqual({ data: null, error: 'DOCUMENT_READ_UNAVAILABLE' })
  })
})
