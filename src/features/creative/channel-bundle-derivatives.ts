/**
 * Channel-specific CreativeBundle Derivatives & Approval Isolation (ANI-1082)
 * Generates distinct bundles for Instagram and Threads from source content
 * and enforces isolated approval lifecycle per channel.
 */

import type { TargetChannel } from './visual-brief-types'
import type {
  CreativeBundle,
  BundleOrderedMediaItem,
} from './creative-bundle-types'
import { createCreativeBundle } from './creative-bundle-engine'

export interface ChannelDerivationInput {
  workspaceId: string
  contentId: string
  versionId: string
  sourceCaption: string
  sourceHashtags: string[]
  sourceMedia: BundleOrderedMediaItem[]
  creativeBriefVersion?: string
}

export function deriveChannelBundles(input: ChannelDerivationInput): {
  instagramBundle: CreativeBundle
  threadsBundle: CreativeBundle
} {
  const {
    workspaceId,
    contentId,
    versionId,
    sourceCaption,
    sourceHashtags,
    sourceMedia,
    creativeBriefVersion = 'v10.0',
  } = input

  // 1. Instagram Derivative: Full caption, all hashtags, all media
  const instagramBundle = createCreativeBundle({
    workspaceId,
    contentId,
    versionId,
    channel: 'instagram',
    caption: sourceCaption,
    hashtags: sourceHashtags,
    orderedMedia: sourceMedia,
    creativeBriefVersion,
  })

  // 2. Threads Derivative: Conversational tone, top 3 hashtags, representative media (first item)
  const threadsCaption = sourceCaption.length > 500
    ? sourceCaption.slice(0, 480).trim() + '...'
    : sourceCaption

  const threadsHashtags = sourceHashtags.slice(0, 3)
  const threadsMedia = sourceMedia.slice(0, 1) // Threads single hero image or full carousel

  const threadsBundle = createCreativeBundle({
    workspaceId,
    contentId,
    versionId,
    channel: 'threads',
    caption: threadsCaption,
    hashtags: threadsHashtags,
    orderedMedia: threadsMedia,
    creativeBriefVersion,
  })

  return { instagramBundle, threadsBundle }
}

export function verifyChannelApprovalIsolation(
  approvedBundle: CreativeBundle,
  targetBundle: CreativeBundle
): boolean {
  // If target bundle is for a different channel, it CANNOT inherit the approval
  if (approvedBundle.channel !== targetBundle.channel) {
    return false
  }
  return approvedBundle.bundleFingerprint === targetBundle.bundleFingerprint
}
