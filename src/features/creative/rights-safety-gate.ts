/**
 * Rights, Consent, and Moderation Visual Safety Gate (ANI-1079, ANI-1098)
 * Validates legal rights, user consent, person presence, and platform safety before publishing.
 */

import type { MediaAsset, ContentVersionMediaBinding } from '../media/media-asset-types'
import { CreativeGenerationError } from './creative-generation-types'

export interface RightsSafetyEvaluationInput {
  workspaceId: string
  mediaAsset: MediaAsset
  containsIdentifiablePerson?: boolean
  personConsentGranted?: boolean
  moderationBlocked?: boolean
}

export interface RightsSafetyEvaluationResult {
  eligibleForPublish: boolean
  reasons: string[]
  violations: string[]
  checkedAt: string
}

export function evaluateMediaRightsAndSafety(
  input: RightsSafetyEvaluationInput
): RightsSafetyEvaluationResult {
  const {
    workspaceId,
    mediaAsset,
    containsIdentifiablePerson = false,
    personConsentGranted = false,
    moderationBlocked = false,
  } = input

  const violations: string[] = []
  const reasons: string[] = []

  // 1. Workspace Tenant Boundary Check
  if (mediaAsset.workspace_id !== workspaceId) {
    violations.push('CROSS_WORKSPACE_ASSET_LEAK')
    reasons.push(`Asset ${mediaAsset.id} belongs to workspace ${mediaAsset.workspace_id}, not ${workspaceId}.`)
  }

  // 2. Moderation Block Check
  if (moderationBlocked) {
    violations.push('MODERATION_BLOCKED')
    reasons.push('Media failed platform safety moderation filters.')
  }

  // 3. Person Presence & Consent Check
  if (containsIdentifiablePerson && !personConsentGranted) {
    violations.push('PERSON_CONSENT_MISSING')
    reasons.push('Identifiable individual present in media without verifiable portrait consent.')
  }

  // 4. Provenance Kind Check
  if (mediaAsset.source_type.startsWith('LEGACY_')) {
    violations.push('LEGACY_UNVERIFIED_PROVENANCE')
    reasons.push(`Legacy asset (${mediaAsset.source_type}) cannot be admitted for fresh publishing.`)
  }

  // 5. Rights Status Check
  if (mediaAsset.rights_status !== 'approved' && mediaAsset.rights_status !== 'confirmed') {
    violations.push('RIGHTS_NOT_CONFIRMED')
    reasons.push(`Rights status is "${mediaAsset.rights_status}". Must be approved or confirmed.`)
  }

  const eligibleForPublish = violations.length === 0

  return {
    eligibleForPublish,
    reasons,
    violations,
    checkedAt: new Date().toISOString(),
  }
}

export function validateCarouselMediaIntegrity(
  workspaceId: string,
  bindings: ContentVersionMediaBinding[],
  assets: MediaAsset[]
): void {
  if (bindings.length === 0) {
    throw new CreativeGenerationError('Carousel must have at least one media asset.', 'EMPTY_CAROUSEL')
  }

  const assetMap = new Map(assets.map(a => [a.id, a]))
  const seenPositions = new Set<number>()

  for (const b of bindings) {
    if (b.workspace_id !== workspaceId) {
      throw new CreativeGenerationError('Cross-workspace media binding detected.', 'CROSS_WORKSPACE_BINDING')
    }

    if (seenPositions.has(b.position)) {
      throw new CreativeGenerationError(`Duplicate carousel position ${b.position} detected.`, 'DUPLICATE_CAROUSEL_POSITION')
    }
    seenPositions.add(b.position)

    const asset = assetMap.get(b.media_asset_id)
    if (!asset) {
      throw new CreativeGenerationError(`Bound media asset ${b.media_asset_id} not found in repository.`, 'MEDIA_ASSET_NOT_FOUND')
    }

    if (asset.workspace_id !== workspaceId) {
      throw new CreativeGenerationError('Cross-workspace media asset reference prohibited.', 'CROSS_WORKSPACE_ASSET')
    }
  }
}
