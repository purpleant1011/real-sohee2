import { expect, it, vi } from 'vitest'
import { saveMessageEvidence } from './message-lifecycle-repository'
import type { ServerSupabaseClient } from '@/features/operations/types'
const ws = '10000000-0000-4000-8000-000000000001'
const messageId = '20000000-0000-4000-8000-000000000001'
it('stores a workspace-scoped policy reference rather than inventing a work item resource', async () => {
  const upsert = vi.fn(async () => ({ error: null }))
  const client = { from: () => ({ upsert }) } as unknown as ServerSupabaseClient
  await saveMessageEvidence({ client, workspaceId: ws, messageId, evidence: {
    kind: 'policy', id: ws, title: '가게 크레딧 정책·원장', href: '/app/system?section=credits',
  } })
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ evidence_type: 'policy', evidence_id: ws, workspace_id: ws }), expect.anything())
})
