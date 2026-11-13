import { describe, it, expect, vi } from 'vitest'
import { getCopyBundle, registerManualPublishUrl, VaultBundleError } from '../service'
import type { VaultBundleRepository } from '../repository'
import type { RenditionReader, RenditionSigner, VaultImageRendition } from '../../rendition/repository'
import type { VaultItem, VaultVariantPayload } from '../../types'

describe('VaultBundleService (ANI-1541)', () => {
  const workspaceA = '00000000-0000-0000-0000-00000000000a'
  const workspaceB = '00000000-0000-0000-0000-00000000000b'
  const itemId = '11111111-2222-3333-4444-555555555555'

  const mockItem: VaultItem = {
    id: itemId,
    workspaceId: workspaceA,
    contentId: '00000000-0000-0000-0000-000000000002',
    versionId: '00000000-0000-0000-0000-000000000003',
    channel: 'naver_blog',
    releaseGate: 'HELD_USER',
    holdReason: 'USER_HELD',
    heldAt: '2026-10-08T09:00:00Z',
    heldBy: 'user-1',
    targetDate: null,
    approvedFingerprint: 'b'.repeat(64),
    fingerprintSchemaVersion: 3,
    policyVersion: 'v1',
    specVersion: '2026.10.1',
    approvalState: 'APPROVED',
    approvedBy: 'user-1',
    bundleId: null,
    idempotencyKey: 'idemp-2',
    deletedAt: null,
    createdAt: '2026-10-08T09:00:00Z',
    updatedAt: '2026-10-08T09:00:00Z',
  }

  const mockPayload: VaultVariantPayload = {
    id: 'payload-1',
    workspaceId: workspaceA,
    vaultItemId: itemId,
    payload: {
      title: '블로그 가을 공지',
      text: '가을 영업시간 변경 안내입니다.',
      hashtags: ['공지', '가을'],
    },
    previewArtifacts: {},
    createdAt: '2026-10-08T09:00:00Z',
    updatedAt: '2026-10-08T09:00:00Z',
  }

  const mockRendition: VaultImageRendition = {
    id: 'rend-1',
    workspace_id: workspaceA,
    vault_item_id: itemId,
    source_media_asset_id: 'asset-1',
    channel: 'naver_blog',
    storage_bucket: 'content-media',
    object_path: `vault-renditions/${workspaceA}/${'c'.repeat(64)}.jpg`,
    rendition_content_digest: 'c'.repeat(64),
    rights_expires_at: null,
    qc_expires_at: null,
  }

  function createMockRepo(): VaultBundleRepository {
    let publishedRecord: any = null
    const events: any[] = []

    return {
      getItem: vi.fn(async (wsId, id) => (wsId === workspaceA && id === itemId ? mockItem : null)),
      getVariantPayload: vi.fn(async (wsId, id) => (wsId === workspaceA && id === itemId ? mockPayload : null)),
      getPublishedUrl: vi.fn(async (wsId, id) => (wsId === workspaceA && id === itemId ? publishedRecord : null)),
      savePublishedUrl: vi.fn(async (record) => {
        publishedRecord = {
          ...record,
          id: 'pub-id-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        return publishedRecord
      }),
      appendEvent: vi.fn(async (event) => {
        const stored = { ...event, id: `event-${events.length + 1}`, occurredAt: new Date().toISOString() }
        events.push(stored)
        return stored
      }),
    }
  }

  const mockRenditionReader: RenditionReader = {
    list: vi.fn(async (wsId, id) => (wsId === workspaceA && id === itemId ? [mockRendition] : [])),
  }

  const mockSigner: RenditionSigner = {
    createSignedUrl: vi.fn(async (_bucket, _path, ttl) => `https://signed.test/img?ttl=${ttl}`),
  }

  it('generates copy bundle with ephemeral signed URLs without persisting signed URLs to repository', async () => {
    const repo = createMockRepo()
    const bundle = await getCopyBundle({
      workspaceId: workspaceA,
      itemRef: itemId,
      deps: {
        repository: repo,
        renditionReader: mockRenditionReader,
        signer: mockSigner,
        ttlSeconds: 600,
      },
    })

    expect(bundle.title).toBe('블로그 가을 공지')
    expect(bundle.body).toBe('가을 영업시간 변경 안내입니다.')
    expect(bundle.tags).toEqual(['공지', '가을'])
    expect(bundle.formattedTags).toBe('#공지 #가을')
    expect(bundle.fullText).toContain('블로그 가을 공지')
    expect(bundle.fullText).toContain('#공지 #가을')

    // Ephemeral signed URL delivered
    expect(bundle.images).toHaveLength(1)
    expect(bundle.images[0].signedUrl).toBe('https://signed.test/img?ttl=600')

    // Signed URL must NOT be saved to repository
    expect(repo.savePublishedUrl).not.toHaveBeenCalled()
  })

  it('rejects cross-workspace access with 404', async () => {
    const repo = createMockRepo()
    await expect(
      getCopyBundle({
        workspaceId: workspaceB, // Different workspace
        itemRef: itemId,
        deps: {
          repository: repo,
          renditionReader: mockRenditionReader,
          signer: mockSigner,
        },
      }),
    ).rejects.toThrow(VaultBundleError)
  })

  it.each(['viewer', 'reviewer'] as const)('refuses publish URL registration for %s before touching the repository', async actorRole => {
    const repo = createMockRepo()
    await expect(
      registerManualPublishUrl({
        input: { workspaceId: workspaceA, itemRef: itemId, actorId: 'user-1', actorRole, url: 'https://blog.naver.com/cafe/12345678' },
        deps: { repository: repo },
      }),
    ).rejects.toMatchObject({ status: 403, message: '이 작업은 매장 관리자만 할 수 있어요.' })
    expect(repo.getItem).not.toHaveBeenCalled()
  })

  it('registers manual publish URL, saves unverified status and appends audit event', async () => {
    const repo = createMockRepo()

    const result = await registerManualPublishUrl({
      input: {
        workspaceId: workspaceA,
        itemRef: itemId,
        actorId: 'user-1',
        actorRole: 'manager',
        url: 'https://blog.naver.com/cafe/12345678',
      },
      deps: { repository: repo },
    })

    expect(result.success).toBe(true)
    expect(result.publishedUrl).toBe('https://blog.naver.com/cafe/12345678')
    expect(result.statusLabel).toBe('사장님이 직접 올린 글로 기록됐어요(확인 전)')

    // Check repository save
    expect(repo.savePublishedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: workspaceA,
        vaultItemId: itemId,
        channel: 'naver_blog',
        publishedUrl: 'https://blog.naver.com/cafe/12345678',
        verificationStatus: 'UNVERIFIED',
      }),
    )

    // Check vault_events appended
    expect(repo.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: workspaceA,
        vaultItemId: itemId,
        actorId: 'user-1',
        eventType: 'vault.manual_publish_url_registered',
        payload: expect.objectContaining({
          publishedUrl: 'https://blog.naver.com/cafe/12345678',
          verificationStatus: 'UNVERIFIED',
        }),
      }),
    )

    // Now getCopyBundle should reflect the registered status
    const updatedBundle = await getCopyBundle({
      workspaceId: workspaceA,
      itemRef: itemId,
      deps: {
        repository: repo,
        renditionReader: mockRenditionReader,
        signer: mockSigner,
      },
    })
    expect(updatedBundle.publicationStatus.isPublishedUrlRegistered).toBe(true)
    expect(updatedBundle.publicationStatus.statusLabel).toBe('사장님이 직접 올린 글로 기록됐어요(확인 전)')
  })

  it('rejects invalid or non-https publication URL', async () => {
    const repo = createMockRepo()

    await expect(
      registerManualPublishUrl({
        input: {
          workspaceId: workspaceA,
          itemRef: itemId,
          actorId: 'user-1',
          actorRole: 'manager',
          url: 'http://blog.naver.com/cafe/12345',
        },
        deps: { repository: repo },
      }),
    ).rejects.toThrow('https://')

    await expect(
      registerManualPublishUrl({
        input: {
          workspaceId: workspaceA,
          itemRef: itemId,
          actorId: 'user-1',
          url: 'https://daangn.com/story/1', // Mismatched channel domain
        },
        deps: { repository: repo },
      }),
    ).rejects.toThrow('네이버 블로그 주소')
  })

  it('rejects URL registration from another workspace', async () => {
    const repo = createMockRepo()

    await expect(
      registerManualPublishUrl({
        input: {
          workspaceId: workspaceB, // Alien workspace
          itemRef: itemId,
          actorId: 'user-1',
          url: 'https://blog.naver.com/cafe/12345678',
        },
        deps: { repository: repo },
      }),
    ).rejects.toThrow(VaultBundleError)
  })
})
