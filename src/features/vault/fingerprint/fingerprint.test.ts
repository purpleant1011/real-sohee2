import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { calculateBundleFingerprint } from '../../creative/creative-bundle-engine'
import {
  calculateVaultFingerprintV3,
  createPreviewArtifact,
  findItemsNeedingReapproval,
  verifyVaultFingerprint,
  type VaultFingerprintV3Input,
} from './fingerprint'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const input: VaultFingerprintV3Input = {
  workspaceId: 'ws-1', contentId: 'post-1', versionId: 'rev-1',
  channel: 'instagram', targetAccountId: 'account-1',
  title: 'New pastry',
  textBlockRenderSpec: { channel: 'instagram', blocks: [{ type: 'paragraph', text: 'Fresh today' }, { type: 'heading', text: 'Sale' }], digest: digest('render spec v1') },
  tags: ['#pastry', '#today'], settings: { category: 'bakery', visibility: 'public', coupon: 'SAVE10' },
  images: [{ position: 0, renditionContentDigest: digest('image bytes') }],
}

const fingerprint = (changes: Partial<VaultFingerprintV3Input> = {}) => calculateVaultFingerprintV3({ ...input, ...changes })

describe('ANI-1526 approval fingerprint v3', () => {
  it('has a fixed golden vector for canonical JSON, independent of object key order', () => {
    expect(fingerprint()).toBe('7089dd3263563e5e0c0f2305a1c4db912be430cb55f1a2c36c494414dd257b23')
    expect(fingerprint({ settings: { coupon: 'SAVE10', visibility: 'public', category: 'bakery' } })).toBe(fingerprint())
    expect(fingerprint({ textBlockRenderSpec: { digest: input.textBlockRenderSpec.digest, blocks: input.textBlockRenderSpec.blocks.map(b => ({ text: b.text, type: b.type })), channel: 'instagram' } })).toBe(fingerprint())
  })

  it('changes for one byte of title, body, tag, rendition, render digest, account or settings', () => {
    const original = fingerprint()
    for (const changed of [
      { title: 'New pastry!' },
      { textBlockRenderSpec: { ...input.textBlockRenderSpec, blocks: [{ type: 'paragraph', text: 'Fresh today!' }, input.textBlockRenderSpec.blocks[1]] } },
      { tags: ['#pastry', '#todaY'] },
      { images: [{ position: 0, renditionContentDigest: digest('image byteS') }] },
      { textBlockRenderSpec: { ...input.textBlockRenderSpec, digest: digest('render spec v2') } },
      { targetAccountId: 'account-2' },
      { channel: 'threads', textBlockRenderSpec: { ...input.textBlockRenderSpec, channel: 'threads' } },
      { settings: { ...input.settings, coupon: 'SAVE11' } },
      { settings: { ...input.settings, visibility: 'private' } },
      { settings: { ...input.settings, category: 'bread' } },
    ] satisfies Partial<VaultFingerprintV3Input>[]) expect(fingerprint(changed)).not.toBe(original)
  })

  it('ignores signed URLs, previews, timestamps and target date, including nested extras', () => {
    const extra = { ...input, signedUrl: 'https://one', previewHtml: '<b>one</b>', createdAt: 'yesterday', targetDate: '2026-10-07', images: [{ ...input.images[0], signedUrl: 'https://one' }] }
    const changed = { ...extra, signedUrl: 'https://two', previewHtml: '<b>two</b>', createdAt: 'tomorrow', targetDate: '2026-10-08', images: [{ ...input.images[0], signedUrl: 'https://two' }] }
    expect(calculateVaultFingerprintV3(extra)).toBe(calculateVaultFingerprintV3(changed))
    const preview = createPreviewArtifact({ fingerprintSchemaVersion: 3, fingerprint: fingerprint(), channel: 'instagram', html: '<b>one</b>', screenshotUrl: 'https://one' })
    expect(preview.fingerprint).toBe(fingerprint())
    expect(fingerprint()).toBe(calculateVaultFingerprintV3(input))
  })

  it('fails closed for invalid digest, channel mismatch and ambiguous image positions', () => {
    expect(() => fingerprint({ images: [{ position: 0, renditionContentDigest: 'bad' }] })).toThrow()
    expect(() => fingerprint({ textBlockRenderSpec: { ...input.textBlockRenderSpec, channel: 'threads' } })).toThrow()
    expect(() => fingerprint({ images: [input.images[0], input.images[0]] })).toThrow()
  })

  it('verifies persisted v1 content and v2 bundle hashes without changing their algorithms', () => {
    expect(verifyVaultFingerprint({ fingerprintSchemaVersion: 1, fingerprint: digest('legacy caption'), payload: { caption: ' legacy caption ' } })).toBe(true)
    const legacy = { channel: 'instagram', caption: 'Old', hashtags: ['#old'], orderedMedia: [{ position: 0, role: 'primary' as const, sha256Digest: digest('legacy image'), mediaAssetId: 'media-1' }] }
    const expected = calculateBundleFingerprint(legacy)
    expect(verifyVaultFingerprint({ fingerprintSchemaVersion: 2, fingerprint: expected, payload: legacy })).toBe(true)
    expect(verifyVaultFingerprint({ fingerprintSchemaVersion: 2, fingerprint: '0'.repeat(64), payload: legacy })).toBe(false)
    expect(verifyVaultFingerprint({ fingerprintSchemaVersion: 3, fingerprint: fingerprint(), payload: input })).toBe(true)
    expect(() => verifyVaultFingerprint({ fingerprintSchemaVersion: 4 as 3, fingerprint: fingerprint(), payload: input })).toThrow()
  })

  it('flags only matching approved archived items whose recorded policy is stale and approval-sensitive', () => {
    const items = [
      { id: 'stale', channel: 'instagram', approvalState: 'APPROVED', policyVersions: { text: '1', image: '7' } },
      { id: 'current', channel: 'instagram', approvalState: 'APPROVED', policyVersions: { text: '2' } },
      { id: 'other-channel', channel: 'threads', approvalState: 'APPROVED', policyVersions: { text: '1' } },
      { id: 'already-flagged', channel: 'instagram', approvalState: 'NEEDS_REAPPROVAL', policyVersions: { text: '1' } },
      { id: 'unknown', channel: 'instagram', approvalState: 'APPROVED', policyVersions: {} },
    ] as const
    expect(findItemsNeedingReapproval(items, { policyId: 'text', version: '2', approvalSensitive: true, channel: 'instagram' })).toEqual(['stale', 'unknown'])
    expect(findItemsNeedingReapproval(items, { policyId: 'text', version: '2', approvalSensitive: false, channel: 'instagram' })).toEqual([])
  })
})
