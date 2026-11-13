import 'server-only'

import {
  buildApprovedMetaPublishPayload,
  buildReconciledMetaPublishPayload,
  type ApprovedMetaPublishPayload,
} from './meta-publish-payload'

type Gateway = Readonly<{
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
  createSignedUrl(
    bucket: string,
    objectPath: string,
    expiresIn: number,
  ): Promise<{ data: { signedUrl?: string } | null; error: unknown }>
  probe(url: string, init: RequestInit): Promise<Response>
  fetchMedia?(url: string, init: RequestInit): Promise<Response>
  transformToJpeg?(stream: ReadableStream<Uint8Array>): Promise<Response>
  uploadDerivative?(
    bucket: string,
    objectPath: string,
    body: ArrayBuffer,
    options: Readonly<{
      cacheControl: string
      contentType: 'image/jpeg'
      upsert: true
      metadata: Readonly<Record<string, string>>
    }>,
  ): Promise<{ data: { path?: string } | null; error: unknown }>
}>

export type ApprovedPublishMaterial = Readonly<{
  payload: ApprovedMetaPublishPayload
  mediaUrls: readonly string[]
}>

async function productionGateway(): Promise<Gateway> {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminSupabaseClient()
  return {
    rpc: (name, args) => supabase.rpc(name as never, args as never) as never,
    createSignedUrl: (bucket, objectPath, expiresIn) =>
      supabase.storage.from(bucket).createSignedUrl(objectPath, expiresIn),
    probe: (url, init) => fetch(url, init),
    fetchMedia: (url, init) => fetch(url, init),
    async transformToJpeg(stream) {
      const { getCloudflareContext } = await import('@opennextjs/cloudflare')
      const { env } = await getCloudflareContext({ async: true })
      if (!env.IMAGES) throw new Error('INSTAGRAM_JPEG_TRANSFORM_UNAVAILABLE')
      return (await env.IMAGES.input(stream).output({
        format: 'image/jpeg',
        quality: 90,
      })).response()
    },
    uploadDerivative: (bucket, objectPath, body, options) =>
      supabase.storage.from(bucket).upload(objectPath, body, options),
  }
}

function isExpectedMedia(response: Response, mimeType: string): boolean {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  return response.ok && contentType === mimeType
}

function isJpeg(bytes: ArrayBuffer): boolean {
  const view = new Uint8Array(bytes)
  return view.length >= 4
    && view[0] === 0xff && view[1] === 0xd8
    && view[view.length - 2] === 0xff && view[view.length - 1] === 0xd9
}

export async function prepareInstagramJpegDerivative(
  versionId: string,
  item: ApprovedMetaPublishPayload['media'][number],
  providedGateway?: Gateway,
): Promise<Readonly<{ objectPath: string; signedUrl: string }>> {
  if (item.mimeType !== 'image/png') throw new Error('게시 미디어를 Instagram 형식으로 준비할 수 없습니다.')
  const gateway = providedGateway ?? await productionGateway()
  if (!gateway.fetchMedia || !gateway.transformToJpeg || !gateway.uploadDerivative) {
    throw new Error('게시 미디어를 Instagram 형식으로 준비할 수 없습니다.')
  }
  const sourceSigned = await gateway.createSignedUrl(item.bucket, item.objectPath, 900)
  const sourceUrl = sourceSigned.data?.signedUrl
  if (sourceSigned.error || typeof sourceUrl !== 'string' || !sourceUrl.startsWith('https://')) {
    throw new Error('게시 미디어를 Instagram 형식으로 준비할 수 없습니다.')
  }
  let source: Response
  try {
    source = await gateway.fetchMedia(sourceUrl, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new Error('게시 미디어를 Instagram 형식으로 준비할 수 없습니다.')
  }
  if (!isExpectedMedia(source, 'image/png') || source.body === null) {
    throw new Error('게시 미디어를 Instagram 형식으로 준비할 수 없습니다.')
  }

  let transformed: Response
  try {
    transformed = await gateway.transformToJpeg(source.body)
  } catch {
    throw new Error('게시 미디어를 Instagram 형식으로 준비할 수 없습니다.')
  }
  if (!isExpectedMedia(transformed, 'image/jpeg')) {
    throw new Error('게시 미디어를 Instagram 형식으로 준비할 수 없습니다.')
  }
  const jpeg = await transformed.arrayBuffer()
  if (!isJpeg(jpeg)) throw new Error('게시 미디어를 Instagram 형식으로 준비할 수 없습니다.')

  const separator = item.objectPath.lastIndexOf('/')
  const directory = separator === -1 ? '' : item.objectPath.slice(0, separator + 1)
  const objectPath = `${directory}publish-derivatives/instagram/${versionId}/${item.mediaId}.jpg`
  const uploaded = await gateway.uploadDerivative(item.bucket, objectPath, jpeg, {
    cacheControl: '86400',
    contentType: 'image/jpeg',
    upsert: true,
    metadata: {
      channel: 'instagram',
      contentVersionId: versionId,
      derivativeKind: 'publish-jpeg',
      sourceMediaAssetId: item.mediaId,
      sourceMimeType: item.mimeType,
      sourceObjectPath: item.objectPath,
    },
  })
  if (uploaded.error || uploaded.data?.path !== objectPath) {
    throw new Error('게시 미디어를 Instagram 형식으로 준비할 수 없습니다.')
  }

  const signed = await gateway.createSignedUrl(item.bucket, objectPath, 3600)
  const signedUrl = signed.data?.signedUrl
  if (signed.error || typeof signedUrl !== 'string' || !signedUrl.startsWith('https://')) {
    throw new Error('게시 미디어를 외부 채널에서 읽을 수 없습니다.')
  }
  let response: Response
  try {
    response = await gateway.probe(signedUrl, {
      method: 'HEAD',
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new Error('게시 미디어를 외부 채널에서 읽을 수 없습니다.')
  }
  if (!isExpectedMedia(response, 'image/jpeg')) {
    throw new Error('게시 미디어를 외부 채널에서 읽을 수 없습니다.')
  }
  return Object.freeze({ objectPath, signedUrl })
}

async function loadPublishMaterial(
  workspaceId: string,
  scheduleId: string,
  rpcName: 'load_approved_meta_publish_payload' | 'load_reconciled_meta_publish_payload',
  buildPayload: (input: unknown) => ApprovedMetaPublishPayload,
  providedGateway?: Gateway,
): Promise<ApprovedPublishMaterial> {
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc(rpcName, {
    p_workspace_id: workspaceId,
    p_schedule_id: scheduleId,
  })
  if (result.error || result.data === null) {
    throw new Error('승인된 게시 버전을 다시 확인해 주세요.')
  }
  const payload = buildPayload(result.data)
  if (payload.workspaceId !== workspaceId || payload.scheduleId !== scheduleId) {
    throw new Error('승인된 게시 버전을 다시 확인해 주세요.')
  }

  const mediaUrls: string[] = []
  for (const item of payload.media) {
    let publishObjectPath = item.objectPath
    let publishMimeType = item.mimeType
    let publishUrlSeconds = 900
    let preparedSignedUrl: string | null = null

    if (payload.channel === 'instagram' && item.mimeType === 'image/png') {
      const derivative = await prepareInstagramJpegDerivative(payload.versionId, item, gateway)
      publishObjectPath = derivative.objectPath
      publishMimeType = 'image/jpeg'
      publishUrlSeconds = 3600
      preparedSignedUrl = derivative.signedUrl
    }

    const signed = preparedSignedUrl === null
      ? await gateway.createSignedUrl(item.bucket, publishObjectPath, publishUrlSeconds)
      : { data: { signedUrl: preparedSignedUrl }, error: null }
    const signedUrl = signed.data?.signedUrl
    if (signed.error || typeof signedUrl !== 'string' || !signedUrl.startsWith('https://')) {
      throw new Error('게시 미디어를 외부 채널에서 읽을 수 없습니다.')
    }
    if (preparedSignedUrl !== null) {
      mediaUrls.push(preparedSignedUrl)
      continue
    }
    let response: Response
    try {
      response = await gateway.probe(signedUrl, {
        method: 'HEAD',
        cache: 'no-store',
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new Error('게시 미디어를 외부 채널에서 읽을 수 없습니다.')
    }
    if (!isExpectedMedia(response, publishMimeType)) {
      throw new Error('게시 미디어를 외부 채널에서 읽을 수 없습니다.')
    }
    mediaUrls.push(signedUrl)
  }
  return Object.freeze({ payload, mediaUrls: Object.freeze(mediaUrls) })
}

export function loadApprovedPublishMaterial(
  workspaceId: string,
  scheduleId: string,
  providedGateway?: Gateway,
): Promise<ApprovedPublishMaterial> {
  return loadPublishMaterial(
    workspaceId,
    scheduleId,
    'load_approved_meta_publish_payload',
    buildApprovedMetaPublishPayload,
    providedGateway,
  )
}

export function loadReconciledPublishMaterial(
  workspaceId: string,
  scheduleId: string,
  providedGateway?: Gateway,
): Promise<ApprovedPublishMaterial> {
  return loadPublishMaterial(
    workspaceId,
    scheduleId,
    'load_reconciled_meta_publish_payload',
    buildReconciledMetaPublishPayload,
    providedGateway,
  )
}
