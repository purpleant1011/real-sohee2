import 'server-only'

import { z } from 'zod'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { prepareInstagramJpegDerivative } from './approved-publish-repository'

const retryMediaSchema = z.object({
  workspace_id: z.string().uuid(),
  failed_attempt_id: z.string().uuid(),
  schedule_id: z.string().uuid(),
  version_id: z.string().uuid(),
  channel_connection_id: z.string().uuid(),
  external_account_id: z.string().regex(/^[0-9]{1,255}$/u),
  account_label: z.string().min(2).max(160),
  derivative_size_bytes: z.number().int().positive().safe(),
  media: z.array(z.object({
    media_asset_id: z.string().uuid(),
    bucket_id: z.literal('content-media'),
    object_path: z.string().min(1).max(1024),
    mime_type: z.literal('image/png'),
  }).strict()).length(1),
}).strict()

type Gateway = Readonly<{
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
}>

type AuditDependencies = Gateway & Readonly<{
  createSignedUrl(
    bucket: string,
    objectPath: string,
    expiresIn: number,
  ): Promise<{ data: { signedUrl?: string } | null; error: unknown }>
  probe(url: string, init: RequestInit): Promise<Response>
  loadCredential(
    workspaceId: string,
    connectionId: string,
  ): Promise<Readonly<{
    accessToken: string
    provider: 'instagram'
    externalAccountId: string
    expiresAt: string | null
  }>>
  fetchMeta(input: string, init?: RequestInit): Promise<Response>
}>

const profileSchema = z.object({
  user_id: z.union([z.string(), z.number()]).transform(String),
  username: z.string().min(1).max(120),
}).passthrough()

const publishingLimitSchema = z.object({
  data: z.array(z.object({
    quota_usage: z.number().int().nonnegative(),
    config: z.object({ quota_total: z.number().int().positive() }).passthrough(),
  }).passthrough()).min(1),
}).passthrough()

function derivativeObjectPath(
  versionId: string,
  item: z.infer<typeof retryMediaSchema>['media'][number],
) {
  const separator = item.object_path.lastIndexOf('/')
  const directory = separator === -1 ? '' : item.object_path.slice(0, separator + 1)
  return `${directory}publish-derivatives/instagram/${versionId}/${item.media_asset_id}.jpg`
}

async function productionAuditDependencies(): Promise<AuditDependencies> {
  const supabase = createAdminSupabaseClient()
  const { getCloudflareContext } = await import('@opennextjs/cloudflare')
  const { env } = await getCloudflareContext({ async: true })
  const workerEnv = env as typeof env & Readonly<{ META_CHANNEL_CREDENTIALS_ENCRYPTION_KEY?: unknown }>
  const encodedKey = typeof workerEnv.META_CHANNEL_CREDENTIALS_ENCRYPTION_KEY === 'string'
    ? workerEnv.META_CHANNEL_CREDENTIALS_ENCRYPTION_KEY
    : ''
  if (encodedKey.length === 0) throw new Error('INSTAGRAM_READINESS_CONNECTION_INVALID')
  const { loadChannelCredential } = await import('@/features/channels/credential-repository')
  const gateway = supabase as unknown as Gateway
  return {
    rpc: (name, args) => gateway.rpc(name, args),
    createSignedUrl: (bucket, objectPath, expiresIn) =>
      supabase.storage.from(bucket).createSignedUrl(objectPath, expiresIn),
    probe: (url, init) => fetch(url, init),
    async loadCredential(workspaceId, connectionId) {
      const credential = await loadChannelCredential(
        workspaceId,
        connectionId,
        'instagram',
        gateway,
        encodedKey,
      )
      if (credential.provider !== 'instagram') throw new Error('INSTAGRAM_READINESS_CONNECTION_INVALID')
      return { ...credential, provider: 'instagram' as const }
    },
    fetchMeta: (input, init) => fetch(input, init),
  }
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error('INSTAGRAM_READINESS_PROVIDER_UNAVAILABLE')
  try {
    return await response.json()
  } catch {
    throw new Error('INSTAGRAM_READINESS_PROVIDER_UNAVAILABLE')
  }
}

export async function auditInstagramProviderRejectedRetry(
  input: Readonly<{
    workspaceId: string
    failedAttemptId: string
    expectedAccountLabel: string
  }>,
  providedDependencies?: AuditDependencies,
) {
  const dependencies = providedDependencies ?? await productionAuditDependencies()
  const result = await dependencies.rpc('load_instagram_provider_rejected_retry_media', {
    p_workspace_id: input.workspaceId,
    p_failed_attempt_id: input.failedAttemptId,
  })
  const parsed = retryMediaSchema.safeParse(result.data)
  if (
    result.error
    || !parsed.success
    || parsed.data.workspace_id !== input.workspaceId
    || parsed.data.failed_attempt_id !== input.failedAttemptId
    || parsed.data.account_label !== input.expectedAccountLabel
  ) throw new Error('INSTAGRAM_READINESS_CONTEXT_INVALID')

  const item = parsed.data.media[0]!
  const signed = await dependencies.createSignedUrl(
    item.bucket_id,
    derivativeObjectPath(parsed.data.version_id, item),
    300,
  )
  const signedUrl = signed.data?.signedUrl
  if (signed.error || typeof signedUrl !== 'string' || !signedUrl.startsWith('https://')) {
    throw new Error('INSTAGRAM_READINESS_MEDIA_UNAVAILABLE')
  }
  let mediaResponse: Response
  try {
    mediaResponse = await dependencies.probe(signedUrl, {
      method: 'HEAD',
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new Error('INSTAGRAM_READINESS_MEDIA_UNAVAILABLE')
  }
  const contentType = mediaResponse.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  const declaredContentLength = mediaResponse.headers.get('content-length')
  const contentLength = declaredContentLength === null ? null : Number(declaredContentLength)
  if (
    !mediaResponse.ok
    || contentType !== 'image/jpeg'
    || (contentLength !== null && (
      !Number.isSafeInteger(contentLength)
      || contentLength !== parsed.data.derivative_size_bytes
    ))
  ) {
    throw new Error('INSTAGRAM_READINESS_MEDIA_UNAVAILABLE')
  }

  let credential: Awaited<ReturnType<AuditDependencies['loadCredential']>>
  try {
    credential = await dependencies.loadCredential(
      input.workspaceId,
      parsed.data.channel_connection_id,
    )
  } catch (error) {
    if (error instanceof Error && error.message === '채널 자격 증명을 열 수 없습니다.') {
      throw new Error('INSTAGRAM_READINESS_CREDENTIAL_DECRYPT_FAILED')
    }
    throw new Error('INSTAGRAM_READINESS_CONNECTION_INVALID')
  }
  if (
    credential.provider !== 'instagram'
    || credential.externalAccountId !== parsed.data.external_account_id
    || (credential.expiresAt !== null && Date.parse(credential.expiresAt) <= Date.now() + 5 * 60_000)
  ) throw new Error('INSTAGRAM_READINESS_CONNECTION_INVALID')
  const authorization = { authorization: `Bearer ${credential.accessToken}` }
  const profile = profileSchema.safeParse(await readJson(await dependencies.fetchMeta(
    'https://graph.instagram.com/v26.0/me?fields=user_id%2Cusername',
    { headers: authorization, cache: 'no-store' },
  )))
  const expectedUsername = input.expectedAccountLabel.replace(/^@/u, '')
  if (
    !profile.success
    || profile.data.user_id !== parsed.data.external_account_id
    || profile.data.username !== expectedUsername
  ) throw new Error('INSTAGRAM_READINESS_ACCOUNT_MISMATCH')
  const publishingLimit = publishingLimitSchema.safeParse(await readJson(await dependencies.fetchMeta(
    `https://graph.instagram.com/v26.0/${parsed.data.external_account_id}/content_publishing_limit?fields=quota_usage%2Cconfig`,
    { headers: authorization, cache: 'no-store' },
  )))
  if (!publishingLimit.success) throw new Error('INSTAGRAM_READINESS_PUBLISH_PERMISSION_UNAVAILABLE')

  return Object.freeze({
    accountLabel: parsed.data.account_label,
    externalAccountId: parsed.data.external_account_id,
    credentialActive: true as const,
    profileVerified: true as const,
    publishEligibilityVerified: true as const,
    jpegVerified: true as const,
    jpegContentType: 'image/jpeg' as const,
    jpegContentLength: parsed.data.derivative_size_bytes,
  })
}

export async function prepareInstagramProviderRejectedRetry(
  input: Readonly<{ workspaceId: string; failedAttemptId: string }>,
  providedGateway?: Gateway,
): Promise<Readonly<{ ok: true }>> {
  const gateway = providedGateway ?? createAdminSupabaseClient() as unknown as Gateway
  const result = await gateway.rpc('load_instagram_provider_rejected_retry_media', {
    p_workspace_id: input.workspaceId,
    p_failed_attempt_id: input.failedAttemptId,
  })
  const parsed = retryMediaSchema.safeParse(result.data)
  if (
    result.error
    || !parsed.success
    || parsed.data.workspace_id !== input.workspaceId
    || parsed.data.failed_attempt_id !== input.failedAttemptId
  ) throw new Error('INSTAGRAM_RETRY_MEDIA_NOT_READY')

  const item = parsed.data.media[0]!
  await prepareInstagramJpegDerivative(parsed.data.version_id, {
    mediaId: item.media_asset_id,
    bucket: item.bucket_id,
    objectPath: item.object_path,
    mimeType: item.mime_type,
  })
  return Object.freeze({ ok: true })
}
