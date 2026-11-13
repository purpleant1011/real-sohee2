/**
 * Canonical Media Asset Domain Types & Verification Rules (Wave 1: ANI-1071, ANI-1072, ANI-1073, ANI-1064)
 *
 * Implements 10th Creative Asset Truth SSOT:
 * 1. MediaAsset: Immutable source byte identity, dimensions, SHA-256 digest, and provenance taxonomy.
 * 2. ContentVersionMediaBinding: Ordered (ordinal >= 0), role-assigned, tenant-isolated media linkage.
 * 3. PublishRendition: Channel-specific transform derivative with exact rendition SHA-256.
 * 4. ProviderDeliveryLease: Ephemeral signed URL lease with TTL and usage state.
 */

export const VALID_MEDIA_PROVENANCE_KINDS = [
  'GENERATED_OPENAI',
  'USER_UPLOAD',
  'OWNED_LIBRARY',
  'LEGACY_STATIC',
  'LEGACY_STOCK',
  'LEGACY_UNKNOWN',
] as const

export type MediaProvenanceKind = (typeof VALID_MEDIA_PROVENANCE_KINDS)[number]

export const VALID_MEDIA_LIFECYCLE_STATUSES = [
  'PENDING_VALIDATION',
  'READY',
  'ACTIVE',
  'SUPERSEDED',
  'QUARANTINED',
  'FAILED',
  'DELETED',
  'PUBLISHED',
] as const

export type MediaLifecycleStatus = (typeof VALID_MEDIA_LIFECYCLE_STATUSES)[number]

export const VALID_MEDIA_ROLES = [
  'primary',
  'carousel_item',
  'thumbnail',
] as const

export type MediaRole = (typeof VALID_MEDIA_ROLES)[number]

export interface MediaAsset {
  id: string
  workspace_id: string
  bucket_id: string
  object_path: string
  kind: string // e.g. 'image'
  source_type: MediaProvenanceKind
  mime_type: string
  size_bytes: number
  width: number
  height: number
  sha256_digest: string
  rights_status: string
  lifecycle_status: MediaLifecycleStatus
  publish_eligibility: boolean
  generation_metadata: Record<string, unknown>
  created_by: string
  created_at: string
}

export interface ContentVersionMediaBinding {
  workspace_id: string
  version_id: string
  media_asset_id: string
  position: number
  role: MediaRole
  created_at: string
}

export interface PublishRendition {
  id: string
  workspace_id: string
  source_media_asset_id: string
  channel: string
  transform_policy_version: string
  crop_data?: Record<string, unknown>
  format: string
  quality: number
  width: number
  height: number
  aspect_ratio: string
  storage_bucket: string
  object_path: string
  rendition_sha256: string
  created_at: string
}

export interface ProviderDeliveryLease {
  id: string
  workspace_id: string
  rendition_id: string
  provider: string
  purpose: string
  delivery_url: string
  issued_at: string
  expires_at: string
  status: 'ACTIVE' | 'CONSUMED' | 'EXPIRED' | 'REVOKED'
}

export interface MediaValidationResult {
  isValid: boolean
  publishEligible?: boolean
  errors: string[]
}

const SHA256_REGEX = /^[a-f0-9]{64}$/i

export function validateMediaAssetIntegrity(asset: MediaAsset): MediaValidationResult {
  const errors: string[] = []

  if (!asset.id || asset.id.trim() === '') {
    errors.push('MISSING_ASSET_ID')
  }

  if (!asset.workspace_id || asset.workspace_id.trim() === '') {
    errors.push('MISSING_WORKSPACE_ID')
  }

  if (!VALID_MEDIA_PROVENANCE_KINDS.includes(asset.source_type)) {
    errors.push(`INVALID_PROVENANCE_KIND: ${asset.source_type}`)
  }

  if (!asset.sha256_digest || !SHA256_REGEX.test(asset.sha256_digest)) {
    errors.push('INVALID_SHA256_DIGEST')
  }

  if (!asset.mime_type || !asset.mime_type.startsWith('image/')) {
    errors.push('INVALID_MIME_TYPE')
  }

  if (typeof asset.size_bytes !== 'number' || asset.size_bytes <= 0) {
    errors.push('INVALID_SIZE_BYTES')
  }

  if (typeof asset.width !== 'number' || asset.width <= 0) {
    errors.push('INVALID_WIDTH')
  }

  if (typeof asset.height !== 'number' || asset.height <= 0) {
    errors.push('INVALID_HEIGHT')
  }

  // Publish eligibility: Legacy static/stock or quarantined assets are NEVER eligible
  const isLegacy =
    asset.source_type === 'LEGACY_STATIC' ||
    asset.source_type === 'LEGACY_STOCK' ||
    asset.source_type === 'LEGACY_UNKNOWN'

  const publishEligible = asset.publish_eligibility && !isLegacy && asset.lifecycle_status !== 'QUARANTINED'

  return {
    isValid: errors.length === 0,
    publishEligible,
    errors,
  }
}

export function validateContentVersionMediaBinding(
  binding: ContentVersionMediaBinding,
  mediaAsset?: MediaAsset,
): MediaValidationResult {
  const errors: string[] = []

  if (!binding.workspace_id || binding.workspace_id.trim() === '') {
    errors.push('MISSING_WORKSPACE_ID')
  }

  if (!binding.version_id || binding.version_id.trim() === '') {
    errors.push('MISSING_VERSION_ID')
  }

  if (!binding.media_asset_id || binding.media_asset_id.trim() === '') {
    errors.push('MISSING_MEDIA_ASSET_ID')
  }

  if (typeof binding.position !== 'number' || binding.position < 0) {
    errors.push('INVALID_POSITION')
  }

  if (!VALID_MEDIA_ROLES.includes(binding.role)) {
    errors.push('INVALID_ROLE')
  }

  if (mediaAsset) {
    if (mediaAsset.workspace_id !== binding.workspace_id) {
      errors.push('CROSS_WORKSPACE_MEDIA_BINDING_FORBIDDEN')
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

export function validatePublishRendition(rendition: PublishRendition): MediaValidationResult {
  const errors: string[] = []

  if (!rendition.id || rendition.id.trim() === '') {
    errors.push('MISSING_RENDITION_ID')
  }

  if (!rendition.source_media_asset_id || rendition.source_media_asset_id.trim() === '') {
    errors.push('MISSING_SOURCE_MEDIA_ASSET_ID')
  }

  if (!rendition.rendition_sha256 || !SHA256_REGEX.test(rendition.rendition_sha256)) {
    errors.push('INVALID_RENDITION_SHA256')
  }

  if (typeof rendition.width !== 'number' || rendition.width <= 0) {
    errors.push('INVALID_WIDTH')
  }

  if (typeof rendition.height !== 'number' || rendition.height <= 0) {
    errors.push('INVALID_HEIGHT')
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

export interface LeaseValidationResult extends MediaValidationResult {
  isExpired: boolean
}

export function validateProviderDeliveryLease(lease: ProviderDeliveryLease): LeaseValidationResult {
  const errors: string[] = []
  const now = new Date().getTime()
  const expiresAt = new Date(lease.expires_at).getTime()
  const isExpired = isNaN(expiresAt) || expiresAt <= now

  if (isExpired) {
    errors.push('DELIVERY_LEASE_EXPIRED')
  }

  if (lease.status !== 'ACTIVE') {
    errors.push(`DELIVERY_LEASE_NOT_ACTIVE: ${lease.status}`)
  }

  if (!lease.delivery_url || lease.delivery_url.trim() === '') {
    errors.push('MISSING_DELIVERY_URL')
  }

  return {
    isValid: errors.length === 0,
    isExpired,
    errors,
  }
}
