import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { validateImageBinary } from '@/features/creative/image-binary-validator'
import { CONTENT_MEDIA_BUCKET, computeSha256, resolveMediaSourcePath } from './media-storage'
import { evaluateUploadRights, uploadRightsSchema } from './media-rights'

const MAX_BYTES = 10 * 1024 * 1024
export const mediaUploadInputSchema = z.object({
  mimeType: z.enum(['image/jpeg', 'image/png']),
  sizeBytes: z.number().int().positive().max(MAX_BYTES),
  sha256Digest: z.string().regex(/^[a-f0-9]{64}$/),
  rights: uploadRightsSchema,
})

export class MediaUploadError extends Error {
  constructor(readonly code: string, message: string, readonly status = 422) {
    super(message)
    this.name = 'MediaUploadError'
  }
}

type UploadContext = { admin: any; workspaceId: string; userId: string }
const COLUMNS = 'id,workspace_id,created_by,bucket_id,object_path,mime_type,size_bytes,sha256_digest,provenance_kind,lifecycle_status,rights_status,publish_eligibility,generation_metadata'

/** Caller must authorize workspace membership and manager role before using admin storage. */
export async function beginMediaUpload(params: UploadContext & { input: unknown }) {
  if ((params.input as { mimeType?: string })?.mimeType?.match(/^image\/hei[cf]$/)) {
    throw new MediaUploadError('HEIC_UNSUPPORTED', 'HEIC 사진은 아직 지원하지 않아요. JPG 또는 PNG로 변환한 뒤 다시 골라 주세요.')
  }
  const parsed = mediaUploadInputSchema.safeParse(params.input)
  if (!parsed.success) throw new MediaUploadError('INVALID_UPLOAD', '10MB 이하의 JPG 또는 PNG 사진을 골라 주세요.')
  const input = parsed.data
  const assetId = randomUUID()
  const objectPath = resolveMediaSourcePath(params.workspaceId, assetId, input.mimeType === 'image/png' ? 'png' : 'jpg')
  const { error } = await params.admin.from('media_assets').insert({
    id: assetId, workspace_id: params.workspaceId, created_by: params.userId,
    bucket_id: CONTENT_MEDIA_BUCKET, object_path: objectPath, kind: 'content',
    mime_type: input.mimeType, size_bytes: input.sizeBytes, sha256_digest: input.sha256Digest,
    provenance_kind: 'USER_UPLOAD', lifecycle_status: 'PENDING_VALIDATION',
    rights_status: 'pending', publish_eligibility: false,
    generation_metadata: { source: 'owner-upload', uploadRights: input.rights, original: true },
  })
  if (error) throw new MediaUploadError('ASSET_CREATE_FAILED', '사진을 저장할 준비를 하지 못했어요. 다시 시도해 주세요.', 503)
  const signed = await params.admin.storage.from(CONTENT_MEDIA_BUCKET).createSignedUploadUrl(objectPath, { upsert: false })
  if (signed.error || !signed.data?.token || !signed.data?.signedUrl) {
    throw new MediaUploadError('UPLOAD_URL_FAILED', '사진 전송을 시작하지 못했어요. 다시 시도해 주세요.', 503)
  }
  return { assetId, objectPath, bucketId: CONTENT_MEDIA_BUCKET, token: signed.data.token, signedUrl: signed.data.signedUrl }
}

/** Revocation is one-way here. It never claims to remove already published provider content. */
export async function withdrawMediaRights(params: UploadContext & { assetId: string }) {
  const current = await params.admin.from('media_assets').select(COLUMNS)
    .eq('workspace_id', params.workspaceId).eq('id', params.assetId).maybeSingle()
  if (current.error) throw new MediaUploadError('ASSET_READ_FAILED', '사진 정보를 확인하지 못했어요.', 503)
  const asset = current.data
  if (!asset || asset.workspace_id !== params.workspaceId || asset.provenance_kind !== 'USER_UPLOAD') {
    throw new MediaUploadError('NOT_FOUND', '사진을 찾을 수 없어요.', 404)
  }
  const metadata = asset.generation_metadata ?? {}
  const result = await params.admin.from('media_assets').update({
    rights_status: 'rejected', publish_eligibility: false,
    generation_metadata: { ...metadata,
      rightsWithdrawnAt: metadata.rightsWithdrawnAt ?? new Date().toISOString(),
      rightsWithdrawnBy: metadata.rightsWithdrawnBy ?? params.userId },
  }).eq('workspace_id', params.workspaceId).eq('id', params.assetId).select(COLUMNS).maybeSingle()
  if (result.error || result.data?.id !== params.assetId || result.data?.workspace_id !== params.workspaceId
    || result.data?.rights_status !== 'rejected' || result.data?.publish_eligibility !== false) {
    throw new MediaUploadError('RIGHTS_WITHDRAWAL_UNCONFIRMED', '사진 사용 중단을 확인하지 못했어요. 다시 시도해 주세요.', 503)
  }
  return { assetId: params.assetId, publishEligible: false as const }
}

/** Downloads the exact private object, then persists and reads back the same asset. No provider call. */
export async function completeMediaUpload(params: UploadContext & { assetId: string }) {
  const result = await params.admin.from('media_assets').select(COLUMNS)
    .eq('workspace_id', params.workspaceId).eq('id', params.assetId).maybeSingle()
  if (result.error) throw new MediaUploadError('ASSET_READ_FAILED', '사진 저장 상태를 확인하지 못했어요. 다시 시도해 주세요.', 503)
  const asset = result.data
  if (!asset || asset.workspace_id !== params.workspaceId || asset.created_by !== params.userId
    || asset.provenance_kind !== 'USER_UPLOAD' || asset.bucket_id !== CONTENT_MEDIA_BUCKET
    || !['PENDING_VALIDATION', 'READY'].includes(asset.lifecycle_status)) {
    throw new MediaUploadError('NOT_FOUND', '사진을 찾을 수 없어요. 다시 골라 주세요.', 404)
  }
  const ext = asset.mime_type === 'image/png' ? 'png' : 'jpg'
  if (asset.object_path !== resolveMediaSourcePath(params.workspaceId, params.assetId, ext)) {
    throw new MediaUploadError('NOT_FOUND', '사진을 찾을 수 없어요.', 404)
  }
  const downloaded = await params.admin.storage.from(CONTENT_MEDIA_BUCKET).download(asset.object_path)
  if (downloaded.error || !downloaded.data) {
    throw new MediaUploadError('STORAGE_READBACK', '사진 전송이 아직 확인되지 않았어요. 다시 시도해 주세요.', 503)
  }
  if (downloaded.data.size > MAX_BYTES) throw new MediaUploadError('FILE_TOO_LARGE', '10MB 이하의 사진을 골라 주세요.')
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer())
  if (bytes.byteLength !== asset.size_bytes || computeSha256(bytes) !== asset.sha256_digest) {
    throw new MediaUploadError('CHECKSUM_MISMATCH', '사진이 온전히 전송되지 않았어요. 다시 골라 주세요.')
  }
  let binary
  try {
    binary = validateImageBinary(bytes, { expectedMime: asset.mime_type })
  } catch {
    throw new MediaUploadError('INVALID_IMAGE', '사진 파일을 읽지 못했어요. JPG 또는 PNG 사진을 다시 골라 주세요.')
  }
  const rights = evaluateUploadRights(asset.generation_metadata?.uploadRights)
  const withdrawn = Boolean(asset.generation_metadata?.rightsWithdrawnAt)
  const publishEligible = rights.publishEligible && !withdrawn
  const update = await params.admin.from('media_assets').update({
    width: binary.width, height: binary.height, lifecycle_status: 'READY',
    rights_status: withdrawn ? 'rejected' : rights.rightsStatus, publish_eligibility: publishEligible,
  }).eq('workspace_id', params.workspaceId).eq('id', params.assetId)
    .eq('lifecycle_status', asset.lifecycle_status).eq('rights_status', asset.rights_status).select(COLUMNS).maybeSingle()
  const saved = update.data
  if (update.error || saved?.id !== asset.id || saved?.workspace_id !== params.workspaceId
    || saved?.lifecycle_status !== 'READY' || saved?.sha256_digest !== binary.sha256Digest
    || saved?.publish_eligibility !== publishEligible) {
    throw new MediaUploadError('ASSET_READBACK', '사진 저장 결과를 확인하지 못했어요. 다시 시도해 주세요.', 503)
  }
  return { assetId: saved.id as string, objectPath: saved.object_path as string,
    publishEligible, storageVerified: true as const, source: 'USER_UPLOAD' as const }
}
