import { describe, it, expect } from 'vitest'
import {
  validateImageBinary,
  ImageBinaryValidationError,
  type ValidatedImageBinary,
} from '../../src/features/creative/image-binary-validator'

describe('ANI-1121: GPT-Image Binary Validation (PNG/JPEG/WebP + Dimensions + Fail-Closed)', () => {
  // 1. Valid PNG Fixture (1024 x 1024)
  const validPng1024 = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG Signature
    0x00, 0x00, 0x00, 0x0d, // IHDR chunk length (13)
    0x49, 0x48, 0x44, 0x52, // "IHDR"
    0x00, 0x00, 0x04, 0x00, // width: 1024 (0x0400)
    0x00, 0x00, 0x04, 0x00, // height: 1024 (0x0400)
    0x08, 0x06, 0x00, 0x00, 0x00, // bit depth 8, color type 6 (RGBA), etc.
    0x70, 0xe2, 0x95, 0x9f, // CRC
    0x00, 0x00, 0x00, 0x00, // IEND length
    0x49, 0x45, 0x4e, 0x44, // "IEND"
    0xae, 0x42, 0x60, 0x82, // CRC
  ])

  // 2. Valid JPEG Fixture (1024 x 1536)
  const validJpeg1024x1536 = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, // SOI + APP0 marker
    0x00, 0x10, // APP0 length 16
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
    0xff, 0xc0, // SOF0 (Start of Frame)
    0x00, 0x11, // length 17
    0x08, // precision 8-bit
    0x06, 0x00, // height: 1536 (0x0600)
    0x04, 0x00, // width: 1024 (0x0400)
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, // components
    0xff, 0xd9, // EOI
  ])

  // 3. Valid WebP Extended (VP8X) Fixture (1024 x 1024)
  // RIFF header (12 bytes) + VP8X chunk (18 bytes)
  const validWebpExtended1024 = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, // "RIFF"
    0x1a, 0x00, 0x00, 0x00, // File size - 8 (26 bytes)
    0x57, 0x45, 0x42, 0x50, // "WEBP"
    0x56, 0x50, 0x38, 0x58, // "VP8X"
    0x0a, 0x00, 0x00, 0x00, // VP8X payload size (10 bytes)
    0x00, 0x00, 0x00, 0x00, // flags
    // Canvas Width - 1 (24-bit little endian): 1023 = 0x0003FF -> FF 03 00
    0xff, 0x03, 0x00,
    // Canvas Height - 1 (24-bit little endian): 1023 = 0x0003FF -> FF 03 00
    0xff, 0x03, 0x00,
  ])

  // 4. Valid WebP Lossless (VP8L) Fixture (1024 x 1024)
  const validWebpLossless1024 = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, // "RIFF"
    0x15, 0x00, 0x00, 0x00, // File size
    0x57, 0x45, 0x42, 0x50, // "WEBP"
    0x56, 0x50, 0x38, 0x4c, // "VP8L"
    0x05, 0x00, 0x00, 0x00, // chunk size (5)
    0x2f, // 0x2F signature
    0xff, 0xc3, 0xff, 0x00, // 1024x1024 packed bits (width-1=1023, height-1=1023)
  ])

  describe('Positive Multi-format Detection & Dimension Parsing', () => {
    it('validates PNG binary and extracts width and height correctly', () => {
      const result: ValidatedImageBinary = validateImageBinary(validPng1024)

      expect(result.mimeType).toBe('image/png')
      expect(result.format).toBe('png')
      expect(result.width).toBe(1024)
      expect(result.height).toBe(1024)
      expect(result.byteLength).toBe(validPng1024.byteLength)
      expect(result.sha256Digest).toHaveLength(64)
    })

    it('validates JPEG binary and extracts width and height from SOF0 frame', () => {
      const result: ValidatedImageBinary = validateImageBinary(validJpeg1024x1536)

      expect(result.mimeType).toBe('image/jpeg')
      expect(result.format).toBe('jpeg')
      expect(result.width).toBe(1024)
      expect(result.height).toBe(1536)
      expect(result.byteLength).toBe(validJpeg1024x1536.byteLength)
      expect(result.sha256Digest).toHaveLength(64)
    })

    it('validates WebP Extended (VP8X) binary and extracts dimensions', () => {
      const result: ValidatedImageBinary = validateImageBinary(validWebpExtended1024)

      expect(result.mimeType).toBe('image/webp')
      expect(result.format).toBe('webp')
      expect(result.width).toBe(1024)
      expect(result.height).toBe(1024)
      expect(result.byteLength).toBe(validWebpExtended1024.byteLength)
      expect(result.sha256Digest).toHaveLength(64)
    })

    it('validates WebP Lossless (VP8L) binary and extracts dimensions', () => {
      const result: ValidatedImageBinary = validateImageBinary(validWebpLossless1024)

      expect(result.mimeType).toBe('image/webp')
      expect(result.format).toBe('webp')
      expect(result.width).toBe(1024)
      expect(result.height).toBe(1024)
      expect(result.byteLength).toBe(validWebpLossless1024.byteLength)
      expect(result.sha256Digest).toHaveLength(64)
    })
  })

  describe('Expected MIME & Dimension Policy Enforcement', () => {
    it('succeeds when actual MIME matches expected MIME', () => {
      const result = validateImageBinary(validPng1024, { expectedMime: 'image/png' })
      expect(result.mimeType).toBe('image/png')
    })

    it('fails closed when MIME is mislabeled (e.g. expected JPEG but got PNG)', () => {
      expect(() =>
        validateImageBinary(validPng1024, { expectedMime: 'image/jpeg' })
      ).toThrowError(/MIME_MISMATCH/)
    })

    it('fails closed when actual dimensions do not match expected dimensions', () => {
      expect(() =>
        validateImageBinary(validPng1024, {
          expectedDimensions: { width: 1024, height: 1536 },
        })
      ).toThrowError(/DIMENSIONS_MISMATCH/)
    })
  })

  describe('Fail-Closed Negative Tests (Corrupted, Truncated, Empty)', () => {
    it('fails closed on empty buffer (0 bytes)', () => {
      expect(() => validateImageBinary(new Uint8Array([]))).toThrowError(
        /EMPTY_IMAGE_BYTES/
      )
    })

    it('fails closed on truncated header (< 8 bytes)', () => {
      const tiny = new Uint8Array([0x89, 0x50, 0x4e])
      expect(() => validateImageBinary(tiny)).toThrowError(/TRUNCATED_IMAGE_HEADER/)
    })

    it('fails closed on unrecognized magic signature (e.g. text/html or random binary)', () => {
      const htmlBytes = new TextEncoder().encode('<!DOCTYPE html><html><body>error</body></html>')
      expect(() => validateImageBinary(htmlBytes)).toThrowError(/UNKNOWN_IMAGE_SIGNATURE/)
    })

    it('fails closed on corrupted PNG without IHDR chunk', () => {
      const corruptedPng = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG Signature (8)
        0x00, 0x00, 0x00, 0x0c, // Chunk length 12 (4)
        0x42, 0x41, 0x44, 0x44, // "BADD" chunk instead of IHDR (4)
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, // Data (8)
        0xaa, 0xbb, 0xcc, 0xdd, // CRC (4) -> total 28 bytes >= 24 bytes
      ])
      expect(() => validateImageBinary(corruptedPng)).toThrowError(/INVALID_PNG_IHDR/)
    })

    it('fails closed on corrupted WebP without valid RIFF/WEBP header', () => {
      const brokenWebp = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, // "RIFF"
        0x10, 0x00, 0x00, 0x00,
        0x41, 0x56, 0x49, 0x20, // "AVI " instead of "WEBP"
      ])
      expect(() => validateImageBinary(brokenWebp)).toThrowError(/UNKNOWN_IMAGE_SIGNATURE/)
    })
  })

  describe('GenerationOrchestrator Multi-format & Binary Validation Integration', () => {
    const createMockBrief = () => ({
      briefVersion: 'v11.0',
      workspaceId: 'ws-binary-test',
      contentVersionId: 'ver-binary-test',
      businessContext: {
        name: '소희 베이커리',
        industry: 'bakery' as const,
        keywords: ['크로와상'],
        targetAudience: '2030',
      },
      productContext: {
        name: '버터 크로와상',
        sellingPoints: ['프랑스산 AOP 버터'],
      },
      channelSpec: { channel: 'instagram' as const, aspectRatio: '1:1' as const },
      creativeDirection: {
        heroSubject: '크로와상',
        composition: 'macro',
        environment: 'marble table',
        lighting: 'morning sunlight',
        colorPalette: ['#gold'],
        stylePreset: 'editorial_photography' as const,
      },
      negativeConstraints: {
        forbiddenTokens: [],
        textRendering: 'NO_TEXT_IN_IMAGE' as const,
        prohibitedDomains: [],
      },
      captionSummary: '버터 향 가득한 크로와상',
      promptText: 'Golden flaky French croissant on marble counter',
      promptDigest: 'sha256-prompt-croissant',
      createdAt: new Date().toISOString(),
    })

    it('successfully handles WebP output with accurate dimensions and .webp storage path', async () => {
      const { GenerationOrchestrator, InMemoryStorageAdapter, InMemoryPersistenceAdapter } =
        await import('../../src/features/creative/generation-orchestrator')

      const webpClient = {
        generateImage: async () => ({
          bytes: validWebpExtended1024,
          mimeType: 'image/webp',
          sha256Digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          providerRequestId: 'req_webp_test_001',
          model: 'gpt-image-2.5-flare',
          promptTokensEstimate: 30,
          imageTokensEstimate: 1024,
        }),
      }

      const storage = new InMemoryStorageAdapter()
      const persistence = new InMemoryPersistenceAdapter()
      const orchestrator = new GenerationOrchestrator({
        imageClient: webpClient as any,
        storageAdapter: storage,
        persistenceAdapter: persistence,
      })

      const result = await orchestrator.execute({
        idempotencyKey: 'idem-webp-001',
        requestFingerprint: 'fp-webp-001',
        sequenceNumber: 1,
        workspaceId: 'ws-binary-test',
        contentVersionId: 'ver-binary-test',
        visualBrief: createMockBrief(),
      })

      expect(result.status).toBe('READY')
      expect(result.mediaAsset?.mime_type).toBe('image/webp')
      expect(result.mediaAsset?.width).toBe(1024)
      expect(result.mediaAsset?.height).toBe(1024)
      expect(result.mediaAsset?.object_path).toMatch(/\.webp$/)
      expect(result.mediaAsset?.generation_metadata.format).toBe('webp')
      expect(result.mediaAsset?.generation_metadata.verifiedAt).toBeDefined()

      // Verify stored file in private bucket has .webp path
      const storedKey = `content-media/${result.mediaAsset?.object_path}`
      expect(storage.uploaded.has(storedKey)).toBe(true)
    })

    it('successfully handles JPEG output with portrait dimensions (1024x1536) and .jpeg path', async () => {
      const { GenerationOrchestrator, InMemoryStorageAdapter, InMemoryPersistenceAdapter } =
        await import('../../src/features/creative/generation-orchestrator')

      const jpegClient = {
        generateImage: async () => ({
          bytes: validJpeg1024x1536,
          mimeType: 'image/jpeg',
          sha256Digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          providerRequestId: 'req_jpeg_test_001',
          model: 'gpt-image-2.5-flare',
          promptTokensEstimate: 30,
          imageTokensEstimate: 1536,
        }),
      }

      const storage = new InMemoryStorageAdapter()
      const persistence = new InMemoryPersistenceAdapter()
      const orchestrator = new GenerationOrchestrator({
        imageClient: jpegClient as any,
        storageAdapter: storage,
        persistenceAdapter: persistence,
      })

      const result = await orchestrator.execute({
        idempotencyKey: 'idem-jpeg-001',
        requestFingerprint: 'fp-jpeg-001',
        sequenceNumber: 1,
        workspaceId: 'ws-binary-test',
        contentVersionId: 'ver-binary-test',
        visualBrief: createMockBrief(),
        size: '1024x1536',
      })

      expect(result.status).toBe('READY')
      expect(result.mediaAsset?.mime_type).toBe('image/jpeg')
      expect(result.mediaAsset?.width).toBe(1024)
      expect(result.mediaAsset?.height).toBe(1536)
      expect(result.mediaAsset?.object_path).toMatch(/\.jpeg$/)
      expect(result.mediaAsset?.generation_metadata.format).toBe('jpeg')
    })

    it('fails closed and blocks storage upload when provider returns corrupted/HTML bytes', async () => {
      const { GenerationOrchestrator, InMemoryStorageAdapter, InMemoryPersistenceAdapter } =
        await import('../../src/features/creative/generation-orchestrator')

      const corruptClient = {
        generateImage: async () => ({
          bytes: new TextEncoder().encode('<html><body>502 Bad Gateway</body></html>'),
          mimeType: 'image/png',
          sha256Digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          providerRequestId: 'req_corrupt_test_001',
          model: 'gpt-image-2.5-flare',
          promptTokensEstimate: 10,
          imageTokensEstimate: 1024,
        }),
      }

      const storage = new InMemoryStorageAdapter()
      const persistence = new InMemoryPersistenceAdapter()
      const orchestrator = new GenerationOrchestrator({
        imageClient: corruptClient as any,
        storageAdapter: storage,
        persistenceAdapter: persistence,
      })

      await expect(
        orchestrator.execute({
          idempotencyKey: 'idem-corrupt-001',
          requestFingerprint: 'fp-corrupt-001',
          sequenceNumber: 1,
          workspaceId: 'ws-binary-test',
          contentVersionId: 'ver-binary-test',
          visualBrief: createMockBrief(),
        })
      ).rejects.toThrowError(/UNKNOWN_IMAGE_SIGNATURE/)

      // Ensure storage upload was NEVER invoked!
      expect(storage.uploaded.size).toBe(0)
    })
  })
})
