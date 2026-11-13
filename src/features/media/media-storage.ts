import { createHash } from 'node:crypto'

/**
 * Media Storage Operations & Canonical Path Contracts (ANI-1072)
 *
 * Enforces private Storage SSOT:
 * - Bucket: content-media
 * - Source path: workspaces/{workspaceId}/media/source/{mediaAssetId}/original.{ext}
 * - Rendition path: workspaces/{workspaceId}/media/renditions/{renditionId}/publish.{ext}
 */

export const CONTENT_MEDIA_BUCKET = 'content-media'

export function computeSha256(bytes: Buffer | Uint8Array): string {
  const hash = createHash('sha256')
  hash.update(bytes)
  return hash.digest('hex')
}

function mediaPathExtension(workspaceId: string, assetId: string, extension: string): string {
  const cleanExt = extension.replace(/^\./, '').toLowerCase()
  if (!/^[a-zA-Z0-9_-]+$/.test(workspaceId) || !/^[a-zA-Z0-9_-]+$/.test(assetId) || !/^[a-z0-9]+$/.test(cleanExt)) {
    throw new Error('INVALID_MEDIA_PATH')
  }
  return cleanExt
}

export function resolveMediaSourcePath(workspaceId: string, mediaAssetId: string, extension: string): string {
  const cleanExt = mediaPathExtension(workspaceId, mediaAssetId, extension)
  return `workspaces/${workspaceId}/media/source/${mediaAssetId}/original.${cleanExt}`
}

export function resolvePublishRenditionPath(workspaceId: string, renditionId: string, extension: string): string {
  const cleanExt = mediaPathExtension(workspaceId, renditionId, extension)
  return `workspaces/${workspaceId}/media/renditions/${renditionId}/publish.${cleanExt}`
}

export function verifyStorageBytesIntegrity(bytes: Buffer | Uint8Array, expectedSha256: string): boolean {
  if (!expectedSha256 || expectedSha256.trim() === '') {
    return false
  }
  const actualSha256 = computeSha256(bytes)
  return actualSha256.toLowerCase() === expectedSha256.toLowerCase()
}
