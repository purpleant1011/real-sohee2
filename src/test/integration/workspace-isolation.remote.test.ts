import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createRemoteTestContext,
  type RemoteTestContext,
} from './remote-harness'

describe('remote workspace isolation', () => {
  let context: RemoteTestContext | undefined

  beforeAll(async () => {
    context = await createRemoteTestContext()
  })

  afterAll(async () => {
    await context?.cleanup()
  })

  it('keeps workspace B lifecycle rows invisible and immutable from actor A', async () => {
    if (!context) throw new Error('integration_context_missing')

    const originalTitle = `Workspace B private content ${context.runId}`
    const attemptedTitle = `Workspace A attempted update ${context.runId}`
    const { data: foreignContent, error: insertError } = await context.actorB.client
      .from('content_items')
      .insert({
        workspace_id: context.actorB.workspaceId,
        channel: 'instagram',
        title: originalTitle,
        created_by: context.actorB.userId,
      })
      .select('id, title')
      .single()

    expect(insertError).toBeNull()
    expect(foreignContent?.title).toBe(originalTitle)

    const foreignWorkspaceId = context.actorB.workspaceId
    const reads = await Promise.all([
      context.actorA.client.from('workspaces').select('id').eq('id', foreignWorkspaceId),
      context.actorA.client
        .from('workspace_members')
        .select('workspace_id, user_id')
        .eq('workspace_id', foreignWorkspaceId),
      context.actorA.client
        .from('content_items')
        .select('id')
        .eq('workspace_id', foreignWorkspaceId),
      context.actorA.client
        .from('content_versions')
        .select('id')
        .eq('workspace_id', foreignWorkspaceId),
      context.actorA.client
        .from('approvals')
        .select('id')
        .eq('workspace_id', foreignWorkspaceId),
      context.actorA.client
        .from('schedules')
        .select('id')
        .eq('workspace_id', foreignWorkspaceId),
    ])

    for (const read of reads) {
      expect(read.error).toBeNull()
      expect(read.data).toEqual([])
    }

    const { data: attemptedRows, error: updateError } = await context.actorA.client
      .from('content_items')
      .update({ title: attemptedTitle })
      .eq('workspace_id', foreignWorkspaceId)
      .eq('id', foreignContent?.id ?? '')
      .select('id')

    expect(updateError).toBeNull()
    expect(attemptedRows).toEqual([])

    const { data: persistedContent, error: verifyError } = await context.admin
      .from('content_items')
      .select('title')
      .eq('workspace_id', foreignWorkspaceId)
      .eq('id', foreignContent?.id ?? '')
      .single()

    expect(verifyError).toBeNull()
    expect(persistedContent?.title).toBe(originalTitle)
  })
})
