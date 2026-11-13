/**
 * Publish Input Contract Validator & Approved Bundle Resolution (ANI-1131)
 * Strips raw images[] and imageUrl client inputs, enforcing that publishing
 * authorities originate ONLY from cryptographically verified approved CreativeBundles.
 */

import type { TargetChannel, CreativeBundle } from '../creative/creative-bundle-types'
import type { SupabaseCreativeBundleStore } from '../creative/creative-bundle-store'
import { calculateBundleFingerprint } from '../creative/creative-bundle-engine'
import { ApprovalIntegrityError } from '../creative/approval-invalidation-engine'

export class RawImagesContractViolationError extends Error {
  readonly code = 'RAW_IMAGES_INPUT_FORBIDDEN'
  constructor(message: string) {
    super(message)
    this.name = 'RawImagesContractViolationError'
  }
}

export class ApprovedBundleRequiredError extends Error {
  readonly code = 'APPROVED_BUNDLE_REQUIRED'
  constructor(message: string) {
    super(message)
    this.name = 'ApprovedBundleRequiredError'
  }
}

export interface ValidatedPublishInput {
  channel: 'INSTAGRAM' | 'THREADS' | 'BOTH' | 'NAVER' | 'DAANGN'
  bundleId?: string
  contentId?: string
  versionId?: string
  expectedFingerprint?: string
  idempotencyKey?: string
}

/**
 * Validates the publish input payload.
 * Blocks any arbitrary client-supplied external image URLs.
 */
export function validatePublishInputContract(body: any): ValidatedPublishInput {
  if (!body || typeof body !== 'object') {
    throw new RawImagesContractViolationError('Request body must be an object')
  }

  // 1. Block client-supplied raw imageUrl
  if (body.imageUrl !== undefined && body.imageUrl !== null && body.imageUrl !== '') {
    throw new RawImagesContractViolationError(
      'Security violation: Client-supplied "imageUrl" is forbidden. All media assets must be resolved from an approved CreativeBundle.'
    )
  }

  // 2. Block client-supplied images[] array completely (11th Master Contract)
  if (Array.isArray(body.images) && body.images.length > 0) {
    throw new RawImagesContractViolationError(
      'Security violation: Client-supplied "images" array is forbidden. All media assets must be resolved from an approved CreativeBundle.'
    )
  }

  const rawChannel = (body.channel || 'INSTAGRAM').toUpperCase()
  const validChannels = ['INSTAGRAM', 'THREADS', 'BOTH', 'NAVER', 'DAANGN']
  if (!validChannels.includes(rawChannel)) {
    throw new RawImagesContractViolationError(`Invalid target channel: ${rawChannel}`)
  }

  return {
    channel: rawChannel as any,
    bundleId: body.bundleId || undefined,
    contentId: body.contentId || undefined,
    versionId: body.versionId || undefined,
    expectedFingerprint: body.expectedFingerprint || body.fingerprint || undefined,
    idempotencyKey: body.idempotencyKey || undefined,
  }
}

export interface ResolvedPublishContext {
  bundle: CreativeBundle
  resolvedCaption: string
  primaryMediaAssetId: string
  primaryMediaSha256: string
  fingerprint: string
  channel: TargetChannel
}

/**
 * Resolves the approved CreativeBundle and authoritative media assets from database.
 * Client-supplied captions or media lists are strictly ignored in favor of DB truth.
 */
export async function resolveApprovedBundlePublishContext(params: {
  workspaceId: string
  bundleId: string
  expectedFingerprint: string
  bundleStore: SupabaseCreativeBundleStore
}): Promise<ResolvedPublishContext> {
  const { workspaceId, bundleId, expectedFingerprint, bundleStore } = params

  const bundle = await bundleStore.getBundleById(workspaceId, bundleId)
  if (!bundle) {
    throw new ApprovedBundleRequiredError(
      `Creative bundle "${bundleId}" was not found in workspace "${workspaceId}".`
    )
  }

  if (bundle.approvalStatus !== 'APPROVED') {
    throw new ApprovedBundleRequiredError(
      `Cannot publish: Creative bundle "${bundleId}" is not approved (status: "${bundle.approvalStatus}"). An approved bundle is strictly required.`
    )
  }

  // Re-verify exact bundle fingerprint
  const liveFingerprint = calculateBundleFingerprint({
    channel: bundle.channel,
    caption: bundle.caption,
    hashtags: bundle.hashtags,
    orderedMedia: bundle.orderedMedia,
    creativeBriefVersion: bundle.creativeBriefVersion,
  })

  if (liveFingerprint !== expectedFingerprint || bundle.approvedFingerprint !== expectedFingerprint) {
    throw new ApprovalIntegrityError(
      `Fingerprint integrity violation: Expected fingerprint "${expectedFingerprint}" does not match approved bundle fingerprint "${bundle.approvedFingerprint || liveFingerprint}".`,
      'APPROVAL_FINGERPRINT_MISMATCH'
    )
  }

  const primaryMedia =
    bundle.orderedMedia.find((m) => m.role === 'primary') || bundle.orderedMedia[0]

  if (!primaryMedia) {
    throw new ApprovedBundleRequiredError(
      `Approved bundle "${bundleId}" contains no bound media assets.`
    )
  }

  const fullCaption = bundle.hashtags.length > 0
    ? `${bundle.caption}\n\n${bundle.hashtags.join(' ')}`.trim()
    : bundle.caption.trim()

  return {
    bundle,
    resolvedCaption: fullCaption,
    primaryMediaAssetId: primaryMedia.mediaAssetId,
    primaryMediaSha256: primaryMedia.sha256Digest,
    fingerprint: liveFingerprint,
    channel: bundle.channel,
  }
}
