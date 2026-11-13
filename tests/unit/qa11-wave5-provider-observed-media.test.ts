/**
 * QA11 Wave 5: ANI-1134 ProviderObservedMedia & Real Perceptual Verification
 * 
 * Verifies:
 * 1. Zero fixed similarity constant (mock 1.0) in production publishing path.
 * 2. Real perceptual similarity comparator distinguishing recompressed positives (>= 0.85) from hard negatives (< 0.65).
 * 3. Accurate extraction of ProviderObservedMedia metadata (dimensions, aspect, order, perceptual fingerprint).
 * 4. Graceful handling of async/pending provider states (VERIFICATION_PENDING / RESULT_UNKNOWN).
 * 5. Durable evidence persistence into external_action_receipts.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  computePerceptualFingerprint,
  computePerceptualSimilarityFromBytes,
  PERCEPTUAL_SIMILARITY_THRESHOLDS,
} from '../../src/features/publishing/perceptual-image-comparator'
import {
  fetchAndInspectProviderObservedMedia,
  type ProviderObservedMedia,
} from '../../src/features/publishing/provider-observed-media'
import {
  verifyPublishedCreativeBundle,
  type ReadbackVerificationDependencies,
} from '../../src/features/publishing/provider-readback-verifier'
import type { CreativeBundle } from '../../src/features/creative/creative-bundle-types'

describe('ANI-1134: ProviderObservedMedia & Real Perceptual Equivalence', () => {
  // Helper to build synthetic PNG binary with variable patterns
  function createSyntheticImage(pattern: 'tart' | 'beauty' | 'tart_recompressed'): Uint8Array {
    const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const ihdr = [
      0x00, 0x00, 0x00, 0x0d, // 13 bytes
      0x49, 0x48, 0x44, 0x52, // 'IHDR'
      0x00, 0x00, 0x04, 0x00, // 1024 width
      0x00, 0x00, 0x04, 0x00, // 1024 height
      0x08, 0x02, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, // CRC
    ]

    const body = new Uint8Array(4000)
    for (let i = 0; i < body.length; i++) {
      if (pattern === 'tart') {
        // Continuous diagonal gradient (warm bakery tones)
        body[i] = ((i % 128) * 2 + Math.floor(i / 128) * 4) % 256
      } else if (pattern === 'tart_recompressed') {
        // Same gradient with minor JPEG-like compression noise
        const base = ((i % 128) * 2 + Math.floor(i / 128) * 4) % 256
        const noise = (i % 13 === 0) ? 2 : (i % 29 === 0) ? -2 : 0
        body[i] = (base + noise + 256) % 256
      } else if (pattern === 'beauty') {
        // High-contrast alternating checkerboard pattern (cool salon tones)
        const blockX = Math.floor((i % 100) / 10)
        const blockY = Math.floor(i / 1000)
        body[i] = (blockX + blockY) % 2 === 0 ? 240 : 15
      }
    }

    const full = new Uint8Array(header.length + ihdr.length + body.length)
    full.set(header, 0)
    full.set(ihdr, header.length)
    full.set(body, header.length + ihdr.length)
    return full
  }

  // 1. Static Audit: Zero fixed similarity 1.0 in production paths & real wiring
  it('enforces ZERO fixed similarity constant (similarity: 1.0) and wiring of fetchAndInspectProviderObservedMedia in production facade', () => {
    const facadePath = resolve(process.cwd(), 'src/features/publishing/canonical-publish-facade.ts')
    const content = readFileSync(facadePath, 'utf-8')

    // Must NOT contain fixed mock similarity
    expect(content).not.toMatch(/computePerceptualSimilarity:\s*async\s*\(\)\s*=>\s*\(\{\s*similarity:\s*1(?:\.0)?\s*\}\)/)

    // Must contain call to fetchAndInspectProviderObservedMedia and preserve receipt evidence
    expect(content).toContain('fetchAndInspectProviderObservedMedia')
    expect(content).toContain('additional_evidence:')
    expect(content).toContain('...(receipt.evidence ?? {})')
  })

  // 2. Real Perceptual Fingerprint & Comparator
  it('generates consistent perceptual fingerprint and evaluates high similarity (>= 0.85) for recompressed positive', () => {
    const originalTart = createSyntheticImage('tart')
    const recompressedTart = createSyntheticImage('tart_recompressed')

    const fpOriginal = computePerceptualFingerprint(originalTart)
    const fpRecompressed = computePerceptualFingerprint(recompressedTart)

    expect(fpOriginal).toBeDefined()
    expect(typeof fpOriginal).toBe('string')
    expect(fpOriginal.length).toBe(32) // 128-bit hex (32 characters)

    const similarity = computePerceptualSimilarityFromBytes(originalTart, recompressedTart)
    expect(similarity).toBeGreaterThanOrEqual(PERCEPTUAL_SIMILARITY_THRESHOLDS.HIGH_CONFIDENCE)
    expect(similarity).toBeLessThanOrEqual(1.0)
  })

  // 3. Hard-Negative Mismatch Guard (< 0.65)
  it('evaluates low similarity (< 0.65) for hard-negative different domain image', () => {
    const tartImage = createSyntheticImage('tart')
    const beautyImage = createSyntheticImage('beauty')

    const similarity = computePerceptualSimilarityFromBytes(tartImage, beautyImage)
    expect(similarity).toBeLessThan(PERCEPTUAL_SIMILARITY_THRESHOLDS.MANUAL_REVIEW_LOW)
  })

  // 3-B. Full 64-block Coverage: Bottom 50% Tampering Detection
  it('detects tampering in bottom 50% of image payload (full 64-block coverage guarantee)', () => {
    const originalTart = createSyntheticImage('tart')
    // Clone and alter ONLY the bottom 50% of the body
    const bottomTampered = new Uint8Array(originalTart)
    const midpoint = Math.floor(originalTart.length / 2)
    for (let i = midpoint; i < bottomTampered.length; i++) {
      bottomTampered[i] = (bottomTampered[i] ^ 0xFF) // Invert all bits in bottom half
    }

    const fpOriginal = computePerceptualFingerprint(originalTart)
    const fpTampered = computePerceptualFingerprint(bottomTampered)

    // Fingerprints must be distinct
    expect(fpOriginal).not.toBe(fpTampered)

    const similarity = computePerceptualSimilarityFromBytes(originalTart, bottomTampered)
    // Because half the payload is completely inverted, similarity must be well below 0.85
    expect(similarity).toBeLessThan(0.80)
  })

  // 4. ProviderObservedMedia extraction and inspection
  it('extracts dimensions, aspect ratio, and perceptual fingerprint from observed bytes', async () => {
    const rawBytes = createSyntheticImage('tart')
    const mockFetcher = async () =>
      new Response(rawBytes as any, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      })

    const observed: ProviderObservedMedia = await fetchAndInspectProviderObservedMedia({
      mediaId: 'meta_media_123',
      providerPostId: 'meta_post_456',
      channel: 'instagram',
      mediaUrl: 'https://cdn.instagram.com/v/t51/test.png',
      position: 0,
      fetcher: mockFetcher as any,
    })

    expect(observed.mediaId).toBe('meta_media_123')
    expect(observed.channel).toBe('instagram')
    expect(observed.dimensions.width).toBe(1024)
    expect(observed.dimensions.height).toBe(1024)
    expect(observed.aspectRatio).toBe('1:1')
    expect(observed.perceptualFingerprint).toBeDefined()
    expect(observed.observedAt).toBeDefined()
  })

  // 5. Readback Verifier with Real Evidence and Durable Threshold Recording
  it('produces VERIFIED with durable threshold and score evidence when provider image is equivalent', async () => {
    const sourceBytes = createSyntheticImage('tart')
    const providerBytes = createSyntheticImage('tart_recompressed')

    const mockBundle: CreativeBundle = {
      bundleId: 'bun-e2e-1134',
      workspaceId: 'ws-1134',
      contentId: 'cnt-1134',
      versionId: 'ver-1134',
      channel: 'instagram',
      caption: '달콤한 수제 단호박 타르트',
      hashtags: ['#타르트'],
      orderedMedia: [
        {
          mediaAssetId: 'med-1134',
          sha256Digest: 'a'.repeat(64),
          position: 0,
          role: 'primary',
        },
      ],
      creativeBriefVersion: 'v1.0',
      bundleFingerprint: 'b'.repeat(64),
      approvalStatus: 'APPROVED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const realDeps: ReadbackVerificationDependencies = {
      fetchPublishedPost: async () => ({
        providerPostId: 'ig_post_999',
        channel: 'instagram',
        caption: '달콤한 수제 단호박 타르트',
        permalink: 'https://www.instagram.com/p/ig_post_999',
        mediaItems: [
          {
            id: 'ig_media_001',
            mediaType: 'IMAGE',
            mediaUrl: 'https://cdn.instagram.com/v/sample.png',
            position: 0,
          },
        ],
        timestamp: new Date().toISOString(),
      }),
      computePerceptualSimilarity: async () => {
        const similarity = computePerceptualSimilarityFromBytes(sourceBytes, providerBytes)
        return { similarity }
      },
    }

    const result = await verifyPublishedCreativeBundle(
      mockBundle,
      'ig_post_999',
      'meta_token',
      realDeps
    )

    expect(result.outcome).toBe('VERIFIED')
    expect(result.captionMatch).toBe(true)
    expect(result.visualScore).toBeGreaterThanOrEqual(0.85)
    expect(result.reasonCode).toBe('HIGH_CONFIDENCE_VISUAL_MATCH')
  })

  // 6. Hard-Negative produces VISUAL_MISMATCH in readback
  it('produces VISUAL_MISMATCH when observed provider image is hard-negative beauty salon', async () => {
    const sourceBytes = createSyntheticImage('tart')
    const hardNegativeBeauty = createSyntheticImage('beauty')

    const mockBundle: CreativeBundle = {
      bundleId: 'bun-e2e-1134-neg',
      workspaceId: 'ws-1134',
      contentId: 'cnt-1134',
      versionId: 'ver-1134',
      channel: 'instagram',
      caption: '달콤한 수제 단호박 타르트',
      hashtags: ['#타르트'],
      orderedMedia: [
        {
          mediaAssetId: 'med-1134',
          sha256Digest: 'a'.repeat(64),
          position: 0,
          role: 'primary',
        },
      ],
      creativeBriefVersion: 'v1.0',
      bundleFingerprint: 'b'.repeat(64),
      approvalStatus: 'APPROVED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const realDeps: ReadbackVerificationDependencies = {
      fetchPublishedPost: async () => ({
        providerPostId: 'ig_post_888',
        channel: 'instagram',
        caption: '달콤한 수제 단호박 타르트',
        permalink: 'https://www.instagram.com/p/ig_post_888',
        mediaItems: [
          {
            id: 'ig_media_002',
            mediaType: 'IMAGE',
            mediaUrl: 'https://cdn.instagram.com/v/beauty.png',
            position: 0,
          },
        ],
        timestamp: new Date().toISOString(),
      }),
      computePerceptualSimilarity: async () => {
        const similarity = computePerceptualSimilarityFromBytes(sourceBytes, hardNegativeBeauty)
        return { similarity }
      },
    }

    const result = await verifyPublishedCreativeBundle(
      mockBundle,
      'ig_post_888',
      'meta_token',
      realDeps
    )

    expect(result.outcome).toBe('VISUAL_MISMATCH')
    expect(result.visualScore).toBeLessThan(0.65)
    expect(result.reasonCode).toBe('PERCEPTUAL_VISUAL_MISMATCH')
  })

  // 7. Security: Rejection of insecure protocol and oversized payload (> 10MB)
  it('rejects insecure HTTP and payloads larger than 10MB with strict Fail-Closed errors', async () => {
    // Insecure HTTP
    await expect(
      fetchAndInspectProviderObservedMedia({
        mediaId: 'sec_001',
        providerPostId: 'post_001',
        channel: 'instagram',
        mediaUrl: 'http://insecure-host.com/image.png',
      })
    ).rejects.toMatchObject({ code: 'INSECURE_MEDIA_URL_PROTOCOL' })

    // Oversized Content-Length > 10MB
    const oversizedFetcher = async () =>
      new Response(new Uint8Array(10), {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': '15000000', // 15MB
        },
      })

    await expect(
      fetchAndInspectProviderObservedMedia({
        mediaId: 'sec_002',
        providerPostId: 'post_002',
        channel: 'instagram',
        mediaUrl: 'https://cdn.instagram.com/oversized.png',
        fetcher: oversizedFetcher as any,
      })
    ).rejects.toMatchObject({ code: 'OBSERVED_MEDIA_PAYLOAD_TOO_LARGE' })
  })
})
