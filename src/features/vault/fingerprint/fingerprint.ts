import { createHash } from 'node:crypto'
import { calculateBundleFingerprint } from '../../creative/creative-bundle-engine'
import type { BundleOrderedMediaItem } from '../../creative/creative-bundle-types'

export const FINGERPRINT_SCHEMA_VERSION = 3 as const
export type VaultChannel = 'instagram' | 'threads' | 'naver_blog' | 'daangn_business'

export interface TextBlockRenderSpec {
  channel: VaultChannel
  blocks: readonly { type: string; text: string }[]
  /** Content digest of the channel-specific render specification, not of rendered HTML. */
  digest: string
}

export interface VaultFingerprintV3Input {
  workspaceId: string
  contentId: string
  versionId: string
  channel: VaultChannel
  targetAccountId: string
  title: string
  textBlockRenderSpec: TextBlockRenderSpec
  tags: readonly string[]
  settings: { category: string | null; visibility: string; coupon: string | null }
  images: readonly { position: number; renditionContentDigest: string }[]
}

/** Rendered previews are separate artifacts: the reference points at approval, never the reverse. */
export interface PreviewArtifact {
  fingerprintSchemaVersion: 1 | 2 | 3
  fingerprint: string
  channel: VaultChannel
  html?: string
  screenshotUrl?: string
}

export function createPreviewArtifact(artifact: PreviewArtifact): PreviewArtifact {
  return { ...artifact }
}

function requireDigest(value: string): string {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Invalid SHA-256 content digest')
  return value.toLowerCase()
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('Invalid canonical fingerprint field')
  return serialized
}

/** Whitelist the approval-relevant fields; never serialize arbitrary request or preview objects. */
export function calculateVaultFingerprintV3(input: VaultFingerprintV3Input): string {
  if (input.channel !== input.textBlockRenderSpec.channel) throw new Error('Render spec channel mismatch')
  for (const value of [input.workspaceId, input.contentId, input.versionId, input.targetAccountId, input.title, input.settings.visibility]) {
    if (typeof value !== 'string' || !value) throw new Error('Missing approval identity or content')
  }
  const images = input.images.map(image => {
    if (!Number.isSafeInteger(image.position) || image.position < 0) throw new Error('Invalid image position')
    return { position: image.position, renditionContentDigest: requireDigest(image.renditionContentDigest) }
  }).sort((a, b) => a.position - b.position)
  if (images.some((image, index) => index > 0 && image.position === images[index - 1].position)) throw new Error('Duplicate image position')
  const payload = {
    fingerprint_schema_version: FINGERPRINT_SCHEMA_VERSION,
    workspaceId: input.workspaceId, contentId: input.contentId, versionId: input.versionId,
    channel: input.channel, targetAccountId: input.targetAccountId, title: input.title,
    textBlockRenderSpec: {
      channel: input.textBlockRenderSpec.channel,
      blocks: input.textBlockRenderSpec.blocks.map(block => ({ type: block.type, text: block.text })),
      digest: requireDigest(input.textBlockRenderSpec.digest),
    },
    tags: [...input.tags],
    settings: { category: input.settings.category, visibility: input.settings.visibility, coupon: input.settings.coupon },
    images,
  }
  return createHash('sha256').update(canonical(payload), 'utf8').digest('hex')
}

/** v1 is the persisted content_versions caption hash; v2 is the persisted CreativeBundle hash. */
export type VaultFingerprintVerification =
  | { fingerprintSchemaVersion: 1; fingerprint: string; payload: { caption: string } }
  | { fingerprintSchemaVersion: 2; fingerprint: string; payload: { channel: string; caption: string; hashtags: string[]; orderedMedia: BundleOrderedMediaItem[]; creativeBriefVersion?: string } }
  | { fingerprintSchemaVersion: 3; fingerprint: string; payload: VaultFingerprintV3Input }

export function verifyVaultFingerprint(record: VaultFingerprintVerification): boolean {
  switch (record.fingerprintSchemaVersion) {
    case 1:
      return createHash('sha256').update(record.payload.caption.trim()).digest('hex') === record.fingerprint
    case 2:
      return calculateBundleFingerprint(record.payload) === record.fingerprint
    case 3:
      return calculateVaultFingerprintV3(record.payload) === record.fingerprint
    default:
      throw new Error('Unknown fingerprint schema version')
  }
}

/** Snapshot at approval time; absent versions fail closed when a sensitive policy changes. */
export type PolicyVersions = Readonly<Record<string, string>>
export interface ArchivedApprovalItem {
  id: string
  channel: VaultChannel
  approvalState: string
  policyVersions: PolicyVersions
}
export interface PolicyChange {
  policyId: string
  version: string
  approvalSensitive: boolean
  channel?: VaultChannel
}

export function findItemsNeedingReapproval<T extends ArchivedApprovalItem>(items: readonly T[], policyChange: PolicyChange): string[] {
  if (!policyChange.approvalSensitive) return []
  return items.filter(item => item.approvalState === 'APPROVED'
    && (!policyChange.channel || item.channel === policyChange.channel)
    && item.policyVersions[policyChange.policyId] !== policyChange.version).map(item => item.id)
}
