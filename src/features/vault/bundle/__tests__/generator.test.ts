import { describe, it, expect } from 'vitest'
import { generateCopyBundle } from '../generator'
import type { VaultItem, VaultVariantPayload } from '../../types'
import type { ManualPublishRecord, VaultBundleImage } from '../types'

describe('generateCopyBundle (ANI-1541)', () => {
  const baseItem: VaultItem = {
    id: '11111111-2222-3333-4444-555555555555',
    workspaceId: '00000000-0000-0000-0000-000000000001',
    contentId: '00000000-0000-0000-0000-000000000002',
    versionId: '00000000-0000-0000-0000-000000000003',
    channel: 'naver_blog',
    releaseGate: 'HELD_USER',
    holdReason: 'USER_HELD',
    heldAt: '2026-10-08T09:00:00Z',
    heldBy: 'user-1',
    targetDate: '2026-10-15',
    approvedFingerprint: 'a'.repeat(64),
    fingerprintSchemaVersion: 3,
    policyVersion: 'v1',
    specVersion: '2026.10.1',
    approvalState: 'APPROVED',
    approvedBy: 'user-1',
    bundleId: null,
    idempotencyKey: 'idemp-1',
    deletedAt: null,
    createdAt: '2026-10-08T09:00:00Z',
    updatedAt: '2026-10-08T09:00:00Z',
  }

  const basePayload: VaultVariantPayload = {
    id: 'payload-1',
    workspaceId: baseItem.workspaceId,
    vaultItemId: baseItem.id,
    payload: {
      title: '소희네 카페 가을 신메뉴 안내',
      text: '안녕하세요! 가을 맞이 밤 라떼가 출시되었습니다.',
      hashtags: ['카페', '가을신메뉴', '밤라떼'],
    },
    previewArtifacts: {},
    createdAt: '2026-10-08T09:00:00Z',
    updatedAt: '2026-10-08T09:00:00Z',
  }

  const sampleImages: VaultBundleImage[] = [
    {
      id: 'rendition-1',
      position: 0,
      storageBucket: 'content-media',
      objectPath: 'vault-renditions/w1/hash1.jpg',
      format: 'jpeg',
      width: 1080,
      height: 1080,
      signedUrl: 'https://storage.test/signed-1?token=temp',
      downloadFilename: 'naver_blog_image_1.jpg',
    },
  ]

  it('generates naver_blog bundle with title, body, tags and fullText', () => {
    const bundle = generateCopyBundle({
      item: baseItem,
      payload: basePayload,
      signedImages: sampleImages,
      manualPublish: null,
      itemRef: 'safe-opaque-ref-123',
    })

    expect(bundle.itemRef).toBe('safe-opaque-ref-123')
    expect(bundle.channel).toBe('naver_blog')
    expect(bundle.channelLabel).toBe('네이버 블로그')
    expect(bundle.title).toBe('소희네 카페 가을 신메뉴 안내')
    expect(bundle.body).toBe('안녕하세요! 가을 맞이 밤 라떼가 출시되었습니다.')
    expect(bundle.tags).toEqual(['카페', '가을신메뉴', '밤라떼'])
    expect(bundle.formattedTags).toBe('#카페 #가을신메뉴 #밤라떼')
    expect(bundle.fullText).toContain('소희네 카페 가을 신메뉴 안내')
    expect(bundle.fullText).toContain('안녕하세요! 가을 맞이 밤 라떼가 출시되었습니다.')
    expect(bundle.fullText).toContain('#카페 #가을신메뉴 #밤라떼')
    expect(bundle.settingsNotice).toContain('직접 선택')
    expect(bundle.images).toHaveLength(1)
    expect(bundle.images[0].signedUrl).toBe('https://storage.test/signed-1?token=temp')

    // Before URL registration
    expect(bundle.publicationStatus.isPublishedUrlRegistered).toBe(false)
    expect(bundle.publicationStatus.statusLabel).toBe('발행 준비 완료 · 외부 게시 전')
    expect(bundle.publicationStatus.publishedUrl).toBeNull()
  })

  it('generates daangn_business bundle with proper copy format', () => {
    const daangnItem = { ...baseItem, channel: 'daangn_business' as const }
    const bundle = generateCopyBundle({
      item: daangnItem,
      payload: basePayload,
      signedImages: sampleImages,
      manualPublish: null,
      itemRef: 'daangn-ref-456',
    })

    expect(bundle.channel).toBe('daangn_business')
    expect(bundle.channelLabel).toBe('당근 비즈니스')
    expect(bundle.fullText).toContain('안녕하세요!')
    expect(bundle.settingsNotice).toContain('당근')
    expect(bundle.settingsNotice).toContain('직접 선택')
  })

  it('reflects manual publish URL when registered with unverified wording', () => {
    const manualPublish: ManualPublishRecord = {
      id: 'rec-1',
      workspaceId: baseItem.workspaceId,
      vaultItemId: baseItem.id,
      channel: 'naver_blog',
      publishedUrl: 'https://blog.naver.com/sohee/2234567890',
      verificationStatus: 'UNVERIFIED',
      registeredBy: 'user-1',
      createdAt: '2026-10-08T10:00:00Z',
      updatedAt: '2026-10-08T10:00:00Z',
    }

    const bundle = generateCopyBundle({
      item: baseItem,
      payload: basePayload,
      signedImages: sampleImages,
      manualPublish,
      itemRef: 'safe-ref',
    })

    expect(bundle.publicationStatus.isPublishedUrlRegistered).toBe(true)
    expect(bundle.publicationStatus.publishedUrl).toBe('https://blog.naver.com/sohee/2234567890')
    expect(bundle.publicationStatus.statusLabel).toBe('사장님이 직접 올린 글로 기록됐어요(확인 전)')
    // Must NOT claim verified
    expect(bundle.publicationStatus.statusLabel).not.toContain('VERIFIED')
    expect(bundle.publicationStatus.statusLabel).not.toContain('검증됨')
    expect(bundle.publicationStatus.statusLabel).not.toContain('확인 완료')
  })

  it('handles missing or empty payload gracefully without throwing', () => {
    const bundle = generateCopyBundle({
      item: baseItem,
      payload: null,
      signedImages: [],
      manualPublish: null,
      itemRef: 'ref-null',
    })

    expect(bundle.title).toBeNull()
    expect(bundle.body).toBe('')
    expect(bundle.tags).toEqual([])
    expect(bundle.formattedTags).toBe('')
    expect(bundle.images).toEqual([])
  })
})
