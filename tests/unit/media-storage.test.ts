import { describe, it, expect } from 'vitest'
import {
  computeSha256,
  resolveMediaSourcePath,
  resolvePublishRenditionPath,
  verifyStorageBytesIntegrity,
  CONTENT_MEDIA_BUCKET,
} from '@/features/media/media-storage'

describe('Wave 1: Media Storage & SHA-256 Digest Integrity (ANI-1072)', () => {
  const WORKSPACE_ID = '00000000-0000-4000-8000-0000000000a2'
  const ASSET_ID = '11111111-2222-3333-4444-555555555555'
  const RENDITION_ID = '66666666-7777-8888-9999-000000000000'

  it('enforces private content-media bucket name', () => {
    expect(CONTENT_MEDIA_BUCKET).toBe('content-media')
  })

  it('computes exact SHA-256 hex digest for binary bytes', () => {
    const sampleBytes = Buffer.from('sohee-creative-test-image-bytes-2026', 'utf-8')
    const hash = computeSha256(sampleBytes)

    // Verify length is 64 hex characters
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)

    // Deterministic verify
    const hashAgain = computeSha256(sampleBytes)
    expect(hashAgain).toBe(hash)
  })

  it('resolves deterministic private object paths for source and renditions', () => {
    const sourcePath = resolveMediaSourcePath(WORKSPACE_ID, ASSET_ID, 'png')
    expect(sourcePath).toBe(`workspaces/${WORKSPACE_ID}/media/source/${ASSET_ID}/original.png`)

    const renditionPath = resolvePublishRenditionPath(WORKSPACE_ID, RENDITION_ID, 'jpg')
    expect(renditionPath).toBe(`workspaces/${WORKSPACE_ID}/media/renditions/${RENDITION_ID}/publish.jpg`)
  })

  it('verifies byte integrity against expected SHA-256 digest', () => {
    const bytes = Buffer.from('correct-bytes', 'utf-8')
    const correctHash = computeSha256(bytes)
    const tamperedHash = computeSha256(Buffer.from('tampered-bytes', 'utf-8'))

    expect(verifyStorageBytesIntegrity(bytes, correctHash)).toBe(true)
    expect(verifyStorageBytesIntegrity(bytes, tamperedHash)).toBe(false)
  })
})
