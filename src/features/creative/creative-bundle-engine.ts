import { createHash, randomUUID } from 'node:crypto'
import type {
  CreativeBundle,
  CreativeBundleInput,
  BundleOrderedMediaItem,
} from './creative-bundle-types'
import { CreativeBundleValidationError } from './creative-bundle-types'

/**
 * Canonical Fingerprint Serialization Rule (ANI-1080)
 * SHA256(channel + "\n" + caption.trim() + "\n" + hashtags.sort().join(",") + "\n" + orderedMedia.sort(by pos).map(m => m.position + ":" + m.role + ":" + m.sha256Digest).join(";") + "\n" + briefVersion)
 */
export function calculateBundleFingerprint(input: {
  channel: string
  caption: string
  hashtags: string[]
  orderedMedia: BundleOrderedMediaItem[]
  creativeBriefVersion?: string
}): string {
  const normChannel = input.channel.trim().toLowerCase()
  const normCaption = input.caption.trim()
  const normHashtags = [...new Set(input.hashtags.map(h => h.trim().toLowerCase()))].sort().join(',')

  const sortedMedia = [...input.orderedMedia].sort((a, b) => a.position - b.position)
  const normMediaStr = sortedMedia
    .map(m => `${m.position}:${m.role}:${m.sha256Digest.trim().toLowerCase()}`)
    .join(';')

  const normBriefVer = (input.creativeBriefVersion || 'v10.0').trim().toLowerCase()

  const payload = [
    `channel:${normChannel}`,
    `caption:${normCaption}`,
    `hashtags:${normHashtags}`,
    `media:${normMediaStr}`,
    `brief:${normBriefVer}`,
  ].join('\n')

  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

export function validateCreativeBundleInput(input: CreativeBundleInput): void {
  if (!input.workspaceId) throw new CreativeBundleValidationError('Workspace ID is required', 'WORKSPACE_REQUIRED')
  if (!input.contentId) throw new CreativeBundleValidationError('Content ID is required', 'CONTENT_ID_REQUIRED')
  if (!input.versionId) throw new CreativeBundleValidationError('Version ID is required', 'VERSION_ID_REQUIRED')
  if (!input.caption || input.caption.trim().length === 0) {
    throw new CreativeBundleValidationError('Caption cannot be empty', 'CAPTION_REQUIRED')
  }
  if (!input.orderedMedia || input.orderedMedia.length === 0) {
    throw new CreativeBundleValidationError('At least one media item must be bound to the bundle', 'MEDIA_REQUIRED')
  }

  // Check unique positions and primary role
  const positions = new Set<number>()
  let hasPrimary = false
  for (const m of input.orderedMedia) {
    if (positions.has(m.position)) {
      throw new CreativeBundleValidationError(`Duplicate media position ${m.position}`, 'DUPLICATE_MEDIA_POSITION')
    }
    positions.add(m.position)

    if (m.position < 0) {
      throw new CreativeBundleValidationError(`Invalid negative position ${m.position}`, 'INVALID_MEDIA_POSITION')
    }

    if (!m.sha256Digest || !/^[a-f0-9]{64}$/i.test(m.sha256Digest)) {
      throw new CreativeBundleValidationError(`Media asset ${m.mediaAssetId} has invalid SHA-256 digest`, 'INVALID_MEDIA_SHA256')
    }

    if (m.role === 'primary') {
      hasPrimary = true
    }
  }

  if (!hasPrimary) {
    throw new CreativeBundleValidationError('Bundle must include at least one primary media item', 'PRIMARY_MEDIA_REQUIRED')
  }
}

export function createCreativeBundle(input: CreativeBundleInput): CreativeBundle {
  validateCreativeBundleInput(input)

  const fingerprint = calculateBundleFingerprint({
    channel: input.channel,
    caption: input.caption,
    hashtags: input.hashtags,
    orderedMedia: input.orderedMedia,
    creativeBriefVersion: input.creativeBriefVersion,
  })

  const now = new Date().toISOString()
  return {
    bundleId: input.bundleId || randomUUID(),
    workspaceId: input.workspaceId,
    contentId: input.contentId,
    versionId: input.versionId,
    channel: input.channel,
    caption: input.caption,
    hashtags: input.hashtags,
    orderedMedia: input.orderedMedia,
    creativeBriefVersion: input.creativeBriefVersion || 'v10.0',
    bundleFingerprint: fingerprint,
    approvalStatus: 'PENDING',
    createdAt: now,
    updatedAt: now,
  }
}

export function mutateCreativeBundle(
  bundle: CreativeBundle,
  updates: Partial<Pick<CreativeBundleInput, 'caption' | 'hashtags' | 'orderedMedia' | 'channel'>>
): CreativeBundle {
  const nextCaption = updates.caption !== undefined ? updates.caption : bundle.caption
  const nextHashtags = updates.hashtags !== undefined ? updates.hashtags : bundle.hashtags
  const nextMedia = updates.orderedMedia !== undefined ? updates.orderedMedia : bundle.orderedMedia
  const nextChannel = updates.channel !== undefined ? updates.channel : bundle.channel

  validateCreativeBundleInput({
    workspaceId: bundle.workspaceId,
    contentId: bundle.contentId,
    versionId: bundle.versionId,
    channel: nextChannel,
    caption: nextCaption,
    hashtags: nextHashtags,
    orderedMedia: nextMedia,
    creativeBriefVersion: bundle.creativeBriefVersion,
  })

  const nextFingerprint = calculateBundleFingerprint({
    channel: nextChannel,
    caption: nextCaption,
    hashtags: nextHashtags,
    orderedMedia: nextMedia,
    creativeBriefVersion: bundle.creativeBriefVersion,
  })

  const hasChanged = nextFingerprint !== bundle.bundleFingerprint
  const now = new Date().toISOString()

  return {
    ...bundle,
    channel: nextChannel,
    caption: nextCaption,
    hashtags: nextHashtags,
    orderedMedia: nextMedia,
    bundleFingerprint: nextFingerprint,
    // If bundle was approved but changed, immediately invalidate approval status to SUPERSEDED (ANI-1081)
    approvalStatus: hasChanged && bundle.approvalStatus === 'APPROVED' ? 'SUPERSEDED' : bundle.approvalStatus,
    updatedAt: now,
  }
}
