/**
 * CreativeBundle Domain Types & Exact Fingerprint Contract (Wave 4: ANI-1080, ANI-1081, ANI-1082)
 * Ensures cryptographically linked atomic approval of Text + Media assets.
 */

import type { MediaRole } from '../media/media-asset-types'
import type { TargetChannel } from './visual-brief-types'
export type { TargetChannel } from './visual-brief-types'

export type BundleApprovalStatus = 'PENDING' | 'APPROVED' | 'SUPERSEDED' | 'REJECTED'

export interface BundleOrderedMediaItem {
  mediaAssetId: string
  sha256Digest: string
  position: number
  role: MediaRole
  cropData?: Record<string, unknown>
}

export interface CreativeBundle {
  bundleId: string
  workspaceId: string
  contentId: string
  versionId: string
  channel: TargetChannel
  caption: string
  hashtags: string[]
  orderedMedia: BundleOrderedMediaItem[]
  creativeBriefVersion: string
  bundleFingerprint: string // SHA-256 hex string (64 chars)
  approvalStatus: BundleApprovalStatus
  approvedFingerprint?: string
  approvedAt?: string
  approvedBy?: string
  createdAt: string
  updatedAt: string
}

export interface CreativeBundleInput {
  bundleId?: string
  workspaceId: string
  contentId: string
  versionId: string
  channel: TargetChannel
  caption: string
  hashtags: string[]
  orderedMedia: BundleOrderedMediaItem[]
  creativeBriefVersion?: string
}

export interface BundleApprovalRecord {
  id: string
  workspaceId: string
  bundleId: string
  bundleFingerprint: string
  channel: TargetChannel
  status: BundleApprovalStatus
  approvedBy: string
  approvedAt: string
  supersededAt?: string
  supersededReason?: string
}

export class CreativeBundleValidationError extends Error {
  readonly code: string
  constructor(message: string, code = 'CREATIVE_BUNDLE_INVALID') {
    super(message)
    this.name = 'CreativeBundleValidationError'
    this.code = code
  }
}
