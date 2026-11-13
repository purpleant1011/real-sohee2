import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createRemoteTestContext,
  type RemoteTestContext,
} from './remote-harness'

describe('remote exact-version content lifecycle', () => {
  let context: RemoteTestContext | undefined

  beforeAll(async () => {
    context = await createRemoteTestContext()
  })

  afterAll(async () => {
    await context?.cleanup()
  })

  it('requires a fresh approval after the approved content version changes', async () => {
    if (!context) throw new Error('integration_context_missing')

    const { actorA } = context
    const { data: connection, error: connectionError } = await context.admin
      .from('channel_connections')
      .insert({
        workspace_id: actorA.workspaceId,
        channel: 'instagram',
        status: 'connected',
        account_label: `Codex ${context.runId}`,
        external_account_id: `integration-${context.runId}`,
      })
      .select('id')
      .single()

    expect(connectionError).toBeNull()
    expect(connection?.id).toBeTruthy()

    const { data: content, error: contentError } = await actorA.client
      .from('content_items')
      .insert({
        workspace_id: actorA.workspaceId,
        channel: 'instagram',
        title: `Exact version lifecycle ${context.runId}`,
        created_by: actorA.userId,
      })
      .select('id')
      .single()

    expect(contentError).toBeNull()
    expect(content?.id).toBeTruthy()

    if (!connection?.id || !content?.id) {
      throw new Error('integration_fixture_create_failed')
    }

    const mediaAssetId = randomUUID()
    const mediaObjectPath = `${actorA.workspaceId}/${actorA.userId}/${mediaAssetId}/integration.png`
    const imageBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    )
    const { error: mediaAssetError } = await context.admin.from('media_assets').insert({
      id: mediaAssetId,
      workspace_id: actorA.workspaceId,
      bucket_id: 'content-media',
      object_path: mediaObjectPath,
      kind: 'content',
      mime_type: 'image/png',
      size_bytes: imageBytes.byteLength,
      rights_status: 'pending',
      created_by: actorA.userId,
    })

    expect(mediaAssetError).toBeNull()

    const { error: mediaUploadError } = await context.admin.storage
      .from('content-media')
      .upload(mediaObjectPath, imageBytes, {
        contentType: 'image/png',
        upsert: false,
      })

    expect(mediaUploadError).toBeNull()
    context.registerStorageObject('content-media', mediaObjectPath)

    const { data: confirmedMedia, error: mediaConfirmError } = await actorA.client
      .from('media_assets')
      .update({ rights_status: 'confirmed' })
      .eq('workspace_id', actorA.workspaceId)
      .eq('id', mediaAssetId)
      .select('id, rights_status')
      .single()

    expect(mediaConfirmError).toBeNull()
    expect(confirmedMedia).toEqual({
      id: mediaAssetId,
      rights_status: 'confirmed',
    })

    const { data: version1Id, error: version1Error } = await actorA.client.rpc(
      'create_content_version',
      {
        p_workspace_id: actorA.workspaceId,
        p_content_id: content.id,
        p_caption: '원격 통합 테스트 버전 1',
        p_hashtags: ['소희', '통합테스트'],
        p_disclosure: 'AI 도움을 받아 작성했습니다.',
        p_metadata: {
          rightsConfirmed: true,
          generationEvidenceConfirmed: true,
          mediaIds: [mediaAssetId],
          knowledgeIds: [],
        },
      },
    )

    expect(version1Error).toBeNull()
    expect(version1Id).toBeTruthy()

    const { data: version1, error: version1ReadError } = await actorA.client
      .from('content_versions')
      .select('fingerprint, version_number')
      .eq('workspace_id', actorA.workspaceId)
      .eq('id', version1Id ?? '')
      .single()

    expect(version1ReadError).toBeNull()
    expect(version1?.version_number).toBe(1)

    if (!version1Id || !version1?.fingerprint) {
      throw new Error('integration_version_create_failed')
    }

    const { data: approval1Id, error: approval1Error } = await actorA.client.rpc(
      'approve_content_version',
      {
        p_workspace_id: actorA.workspaceId,
        p_content_id: content.id,
        p_version_id: version1Id,
        p_expected_fingerprint: version1.fingerprint,
        p_disclosure_confirmed: true,
        p_rights_confirmed: true,
        p_reason: '원격 통합 테스트 버전 1 승인',
      },
    )

    expect(approval1Error).toBeNull()
    expect(approval1Id).toBeTruthy()

    const { data: version2Id, error: version2Error } = await actorA.client.rpc(
      'create_content_version',
      {
        p_workspace_id: actorA.workspaceId,
        p_content_id: content.id,
        p_caption: '원격 통합 테스트 버전 2',
        p_hashtags: ['소희', '재승인'],
        p_disclosure: 'AI 도움을 받아 수정했습니다.',
        p_metadata: {
          rightsConfirmed: true,
          generationEvidenceConfirmed: true,
          mediaIds: [mediaAssetId],
          knowledgeIds: [],
        },
      },
    )

    expect(version2Error).toBeNull()
    expect(version2Id).toBeTruthy()

    if (!approval1Id || !version2Id) {
      throw new Error('integration_version_transition_failed')
    }

    const publishAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    const { data: staleScheduleId, error: staleScheduleError } = await actorA.client.rpc(
      'schedule_approved_content',
      {
        p_workspace_id: actorA.workspaceId,
        p_approval_id: approval1Id,
        p_publish_at: publishAt,
        p_timezone: 'Asia/Seoul',
        p_channel_connection_id: connection.id,
      },
    )

    expect(staleScheduleId).toBeNull()
    expect(staleScheduleError?.message).toContain('승인된 버전만 예약할 수 있습니다.')

    const { data: version2, error: version2ReadError } = await actorA.client
      .from('content_versions')
      .select('fingerprint, version_number')
      .eq('workspace_id', actorA.workspaceId)
      .eq('id', version2Id)
      .single()

    expect(version2ReadError).toBeNull()
    expect(version2?.version_number).toBe(2)

    if (!version2?.fingerprint) {
      throw new Error('integration_version_read_failed')
    }

    const { data: approval2Id, error: approval2Error } = await actorA.client.rpc(
      'approve_content_version',
      {
        p_workspace_id: actorA.workspaceId,
        p_content_id: content.id,
        p_version_id: version2Id,
        p_expected_fingerprint: version2.fingerprint,
        p_disclosure_confirmed: true,
        p_rights_confirmed: true,
        p_reason: '원격 통합 테스트 버전 2 재승인',
      },
    )

    expect(approval2Error).toBeNull()
    expect(approval2Id).toBeTruthy()

    if (!approval2Id) {
      throw new Error('integration_reapproval_failed')
    }

    const { data: scheduleId, error: scheduleError } = await actorA.client.rpc(
      'schedule_approved_content',
      {
        p_workspace_id: actorA.workspaceId,
        p_approval_id: approval2Id,
        p_publish_at: publishAt,
        p_timezone: 'Asia/Seoul',
        p_channel_connection_id: connection.id,
      },
    )

    expect(scheduleError).toBeNull()
    expect(scheduleId).toBeTruthy()

    const [{ data: schedule, error: scheduleReadError }, { data: persistedContent }] =
      await Promise.all([
        actorA.client
          .from('schedules')
          .select('approval_id, content_id, version_id, status')
          .eq('workspace_id', actorA.workspaceId)
          .eq('id', scheduleId ?? '')
          .single(),
        actorA.client
          .from('content_items')
          .select('current_version_id, status')
          .eq('workspace_id', actorA.workspaceId)
          .eq('id', content.id)
          .single(),
      ])

    expect(scheduleReadError).toBeNull()
    expect(schedule).toMatchObject({
      approval_id: approval2Id,
      content_id: content.id,
      version_id: version2Id,
      status: 'scheduled',
    })
    expect(persistedContent).toMatchObject({
      current_version_id: version2Id,
      status: 'scheduled',
    })
  })
})
