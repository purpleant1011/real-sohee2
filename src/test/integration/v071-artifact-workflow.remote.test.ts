import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createRemoteTestContext,
  type RemoteTestContext,
} from './remote-harness'

describe('remote V0.7.1 conversation artifact workflow', () => {
  let context: RemoteTestContext | undefined

  beforeAll(async () => {
    context = await createRemoteTestContext()
  })

  afterAll(async () => {
    await context?.cleanup()
  })

  it('isolates artifacts by workspace and saves one exact v1 idempotently', async () => {
    if (!context) throw new Error('integration_context_missing')

    const { actorA, actorB } = context
    const actorAClient = actorA.client
    const actorBClient = actorB.client
    const admin = context.admin

    const { data: thread, error: threadError } = await actorA.client
      .from('conversation_threads')
      .insert({
        workspace_id: actorA.workspaceId,
        kind: 'operations',
        title: `V0.7.1 artifact ${context.runId}`,
      })
      .select('id')
      .single()

    expect(threadError).toBeNull()
    expect(thread?.id).toBeTruthy()

    if (!thread?.id) throw new Error('integration_thread_create_failed')

    const { data: sourceMessage, error: messageError } = await actorA.client
      .from('messages')
      .insert({
        workspace_id: actorA.workspaceId,
        thread_id: thread.id,
        role: 'user',
        content: '인스타그램 이미지 한 장과 게시물 문안을 만들어줘',
        status: 'completed',
        client_message_id: randomUUID(),
        created_by_user_id: actorA.userId,
      })
      .select('id')
      .single()

    expect(messageError).toBeNull()
    expect(sourceMessage?.id).toBeTruthy()

    if (!sourceMessage?.id) throw new Error('integration_message_create_failed')

    const mediaAssetId = randomUUID()
    const mediaObjectPath = `${actorA.workspaceId}/${actorA.userId}/${mediaAssetId}/v071.png`
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
      rights_status: 'confirmed',
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

    const artifactId = randomUUID()
    const batchId = randomUUID()
    const slideId = randomUUID()
    const generationKey = randomUUID()
    const saveKey = randomUUID()

    const { error: artifactError } = await admin.from('conversation_artifacts').insert({
      id: artifactId,
      workspace_id: actorA.workspaceId,
      type: 'instagram_post',
      status: 'ready_for_review',
      source_message_id: sourceMessage.id,
      caption: '원격에서 만든 소희 V0.7.1 게시물입니다.',
      hashtags: ['소희', '원격검증'],
      cta: '자세한 내용은 프로필에서 확인해 주세요.',
      disclosure: 'AI 도움을 받아 작성했습니다.',
      observations: ['사용자가 인스타그램 게시물을 요청했습니다.'],
      limitations: [],
      evidence: [],
      unresolved_questions: [],
      idempotency_key: generationKey,
      created_by_user_id: actorA.userId,
    })

    expect(artifactError).toBeNull()

    const { error: batchError } = await admin.from('generation_batches').insert({
      id: batchId,
      workspace_id: actorA.workspaceId,
      artifact_id: artifactId,
      requested_count: 1,
      started_count: 1,
      succeeded_count: 1,
      failed_count: 0,
      status: 'succeeded',
      idempotency_key: generationKey,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })

    expect(batchError).toBeNull()

    const { error: directWriteError } = await actorAClient.from('generation_batches').insert({
      workspace_id: actorA.workspaceId,
      artifact_id: artifactId,
      requested_count: 1,
      status: 'queued',
      idempotency_key: randomUUID(),
    })

    expect(directWriteError?.code).toBe('42501')

    const foreignMediaAssetId = randomUUID()
    const { error: foreignMediaError } = await context.admin.from('media_assets').insert({
      id: foreignMediaAssetId,
      workspace_id: actorB.workspaceId,
      bucket_id: 'content-media',
      object_path: `${actorB.workspaceId}/${actorB.userId}/${foreignMediaAssetId}/foreign.png`,
      kind: 'content',
      mime_type: 'image/png',
      size_bytes: imageBytes.byteLength,
      rights_status: 'confirmed',
      created_by: actorB.userId,
    })

    expect(foreignMediaError).toBeNull()

    const { error: foreignSlideError } = await admin.from('artifact_slides').insert({
      workspace_id: actorA.workspaceId,
      artifact_id: artifactId,
      batch_id: batchId,
      position: 2,
      role: 'detail',
      media_asset_id: foreignMediaAssetId,
      alt_text: '다른 작업공간의 이미지가 연결되면 안 됩니다.',
      status: 'succeeded',
      retryable: false,
      rights_status: 'confirmed',
    })

    expect(foreignSlideError?.code).toBe('23503')

    const { error: slideError } = await admin.from('artifact_slides').insert({
      id: slideId,
      workspace_id: actorA.workspaceId,
      artifact_id: artifactId,
      batch_id: batchId,
      position: 1,
      role: 'cover',
      media_asset_id: mediaAssetId,
      alt_text: '밝은 배경 위에 소희 게시물 제목이 있는 표지',
      status: 'succeeded',
      retryable: false,
      rights_status: 'confirmed',
    })

    expect(slideError).toBeNull()

    const { error: messageArtifactError } = await admin.from('message_artifacts').insert({
      workspace_id: actorA.workspaceId,
      message_id: sourceMessage.id,
      artifact_id: artifactId,
    })

    expect(messageArtifactError).toBeNull()

    const { data: visibleArtifact, error: visibleError } = await actorAClient
      .from('conversation_artifacts')
      .select('id, status, caption')
      .eq('id', artifactId)
      .single()

    expect(visibleError).toBeNull()
    expect(visibleArtifact).toMatchObject({
      id: artifactId,
      status: 'ready_for_review',
      caption: '원격에서 만든 소희 V0.7.1 게시물입니다.',
    })

    const { data: foreignArtifacts, error: foreignReadError } = await actorBClient
      .from('conversation_artifacts')
      .select('id')
      .eq('id', artifactId)

    expect(foreignReadError).toBeNull()
    expect(foreignArtifacts).toEqual([])

    const { data: foreignSave, error: foreignSaveError } = await actorBClient.rpc(
      'save_conversation_artifact_to_work',
      {
        p_artifact_id: artifactId,
        p_request_key: saveKey,
      },
    )

    expect(foreignSave).toBeNull()
    expect(foreignSaveError).not.toBeNull()

    const { data: firstSave, error: firstSaveError } = await actorAClient.rpc(
      'save_conversation_artifact_to_work',
      {
        p_artifact_id: artifactId,
        p_request_key: saveKey,
      },
    )

    expect(firstSaveError).toBeNull()
    expect(firstSave).toMatchObject({
      artifactId,
      versionNumber: 1,
    })

    const { data: repeatedSave, error: repeatedSaveError } = await actorAClient.rpc(
      'save_conversation_artifact_to_work',
      {
        p_artifact_id: artifactId,
        p_request_key: saveKey,
      },
    )

    expect(repeatedSaveError).toBeNull()
    expect(repeatedSave).toEqual(firstSave)

    const savedResult = firstSave as {
      contentItemId: string
      versionId: string
      workItemId: string
    }

    const [contentResult, versionResult, mediaResult, workResult, messageResult] =
      await Promise.all([
        actorA.client
          .from('content_items')
          .select('id, current_version_id, status')
          .eq('id', savedResult.contentItemId)
          .single(),
        actorA.client
          .from('content_versions')
          .select('id, version_number, caption, hashtags, disclosure')
          .eq('id', savedResult.versionId)
          .single(),
        actorA.client
          .from('content_version_media')
          .select('media_asset_id, position')
          .eq('version_id', savedResult.versionId),
        actorA.client
          .from('work_items')
          .select('id, content_item_id, source_message_id, status')
          .eq('id', savedResult.workItemId)
          .single(),
        actorA.client
          .from('messages')
          .select('work_item_id')
          .eq('id', sourceMessage.id)
          .single(),
      ])

    expect(contentResult.error).toBeNull()
    expect(contentResult.data).toMatchObject({
      id: savedResult.contentItemId,
      current_version_id: savedResult.versionId,
      status: 'review',
    })
    expect(versionResult.error).toBeNull()
    expect(versionResult.data).toMatchObject({
      id: savedResult.versionId,
      version_number: 1,
      caption:
        '원격에서 만든 소희 V0.7.1 게시물입니다.\n\n자세한 내용은 프로필에서 확인해 주세요.',
      hashtags: ['소희', '원격검증'],
      disclosure: 'AI 도움을 받아 작성했습니다.',
    })
    expect(mediaResult.error).toBeNull()
    expect(mediaResult.data).toEqual([{ media_asset_id: mediaAssetId, position: 0 }])
    expect(workResult.error).toBeNull()
    expect(workResult.data).toMatchObject({
      id: savedResult.workItemId,
      content_item_id: savedResult.contentItemId,
      source_message_id: sourceMessage.id,
      status: 'drafting',
    })
    expect(messageResult.error).toBeNull()
    expect(messageResult.data?.work_item_id).toBe(savedResult.workItemId)

    const [
      { count: contentCount },
      { count: versionCount },
      { count: workCount },
      { count: eventCount },
      { count: notificationCount },
    ] =
      await Promise.all([
        admin
          .from('content_items')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', actorA.workspaceId)
          .eq('id', savedResult.contentItemId),
        admin
          .from('content_versions')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', actorA.workspaceId)
          .eq('content_id', savedResult.contentItemId),
        admin
          .from('work_items')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', actorA.workspaceId)
          .eq('content_item_id', savedResult.contentItemId),
        admin
          .from('operation_events')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', actorA.workspaceId)
          .eq('event_key', `artifact:${artifactId}:saved`),
        admin
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', actorA.workspaceId)
          .eq('user_id', actorA.userId)
          .eq('event_key', `artifact:${artifactId}:saved`),
      ])

    expect(contentCount).toBe(1)
    expect(versionCount).toBe(1)
    expect(workCount).toBe(1)
    expect(eventCount).toBe(1)
    expect(notificationCount).toBe(1)

    const invalidArtifactId = randomUUID()
    const { error: invalidArtifactError } = await admin.from('conversation_artifacts').insert({
      id: invalidArtifactId,
      workspace_id: actorA.workspaceId,
      type: 'instagram_post',
      status: 'ready_for_review',
      source_message_id: sourceMessage.id,
      caption: '이미지가 없어 저장되면 안 되는 결과물',
      idempotency_key: randomUUID(),
      created_by_user_id: actorA.userId,
    })

    expect(invalidArtifactError).toBeNull()

    const { data: invalidSave, error: invalidSaveError } = await actorAClient.rpc(
      'save_conversation_artifact_to_work',
      {
        p_artifact_id: invalidArtifactId,
        p_request_key: randomUUID(),
      },
    )

    expect(invalidSave).toBeNull()
    expect(invalidSaveError).not.toBeNull()

    const { data: rolledBackArtifact, error: rolledBackReadError } = await actorAClient
      .from('conversation_artifacts')
      .select('work_item_id, content_item_id, version_id, save_request_key')
      .eq('id', invalidArtifactId)
      .single()

    expect(rolledBackReadError).toBeNull()
    expect(rolledBackArtifact).toEqual({
      work_item_id: null,
      content_item_id: null,
      version_id: null,
      save_request_key: null,
    })
  })
})
