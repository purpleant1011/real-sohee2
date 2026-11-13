import { describe, expect, it, vi } from 'vitest'
import {
  buildPrivateObjectPath,
  createPrivateSignedUrl,
  PRIVATE_SIGNED_URL_SECONDS,
} from './storage'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const userId = '10000000-0000-4000-8000-000000000001'
const resourceId = '30000000-0000-4000-8000-000000000001'

describe('buildPrivateObjectPath', () => {
  it('builds the approved four-segment private path', () => {
    expect(
      buildPrivateObjectPath({ workspaceId, userId, resourceId, filename: 'photo-01.webp' }),
    ).toBe(`${workspaceId}/${userId}/${resourceId}/photo-01.webp`)
  })

  it.each([
    '../secret.txt',
    'folder/photo.png',
    '.hidden',
    'space name.png',
    '한글.png',
    'a'.repeat(201),
  ])('rejects an unsafe filename: %s', (filename) => {
    expect(() =>
      buildPrivateObjectPath({ workspaceId, userId, resourceId, filename }),
    ).toThrow('안전한 파일 이름을 사용해 주세요.')
  })

  it.each(['not-a-uuid', '', `${workspaceId}/other`])(
    'rejects an invalid path identifier: %s',
    (invalidId) => {
      expect(() =>
        buildPrivateObjectPath({
          workspaceId: invalidId,
          userId,
          resourceId,
          filename: 'safe.png',
        }),
      ).toThrow('업로드 경로 식별자가 올바르지 않습니다.')
    },
  )

  it('snapshots getter-backed path fields once before validation', () => {
    let workspaceReads = 0
    const input = {
      get workspaceId() {
        workspaceReads += 1
        return workspaceReads === 1 ? workspaceId : '../escape'
      },
      userId,
      resourceId,
      filename: 'safe.png',
    }

    expect(buildPrivateObjectPath(input)).toBe(
      `${workspaceId}/${userId}/${resourceId}/safe.png`,
    )
    expect(workspaceReads).toBe(1)
  })
})

describe('createPrivateSignedUrl', () => {
  it('requests a 60-second URL without making a bucket public', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://example.invalid/private-token' },
      error: null,
    })
    const from = vi.fn().mockReturnValue({ createSignedUrl })

    await expect(
      createPrivateSignedUrl(
        { storage: { from } },
        'content-media',
        `${workspaceId}/${userId}/${resourceId}/photo.webp`,
      ),
    ).resolves.toBe('https://example.invalid/private-token')

    expect(PRIVATE_SIGNED_URL_SECONDS).toBe(60)
    expect(from).toHaveBeenCalledWith('content-media')
    expect(createSignedUrl).toHaveBeenCalledWith(
      `${workspaceId}/${userId}/${resourceId}/photo.webp`,
      60,
    )
  })

  it('accepts the three-segment immutable profile image path', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://example.invalid/profile-token' },
      error: null,
    })
    const from = vi.fn().mockReturnValue({ createSignedUrl })
    const path = `${userId}/${resourceId}/avatar.png`

    await expect(
      createPrivateSignedUrl({ storage: { from } }, 'profile-images', path),
    ).resolves.toBe('https://example.invalid/profile-token')
    expect(from).toHaveBeenCalledWith('profile-images')
    expect(createSignedUrl).toHaveBeenCalledWith(path, 60)
  })

  it('accepts the six-segment canonical ANI-1072 media source and rendition paths with custom expiration', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://example.invalid/source-token' },
      error: null,
    })
    const from = vi.fn().mockReturnValue({ createSignedUrl })
    const sourcePath = `workspaces/${workspaceId}/media/source/${resourceId}/original.png`
    const renditionPath = `workspaces/${workspaceId}/media/renditions/${resourceId}/publish.webp`

    await expect(
      createPrivateSignedUrl({ storage: { from } }, 'content-media', sourcePath, 86400),
    ).resolves.toBe('https://example.invalid/source-token')
    expect(createSignedUrl).toHaveBeenCalledWith(sourcePath, 86400)

    await expect(
      createPrivateSignedUrl({ storage: { from } }, 'content-media', renditionPath),
    ).resolves.toBe('https://example.invalid/source-token')
    expect(createSignedUrl).toHaveBeenCalledWith(renditionPath, 60)
  })

  it('accepts the four-segment direct workspace media path', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://example.invalid/direct-token' },
      error: null,
    })
    const from = vi.fn().mockReturnValue({ createSignedUrl })
    const directPath = `workspaces/${workspaceId}/media/banner.jpg`

    await expect(
      createPrivateSignedUrl({ storage: { from } }, 'content-media', directPath),
    ).resolves.toBe('https://example.invalid/direct-token')
    expect(createSignedUrl).toHaveBeenCalledWith(directPath, 60)
  })

  it('rejects unknown buckets before calling Storage', async () => {
    const from = vi.fn()

    await expect(
      createPrivateSignedUrl(
        { storage: { from } },
        'public-assets' as 'content-media',
        `${workspaceId}/${userId}/${resourceId}/photo.webp`,
      ),
    ).rejects.toThrow('허용되지 않은 저장소입니다.')
    expect(from).not.toHaveBeenCalled()
  })

  it('does not leak provider errors through the public error message', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'provider secret path and internal details' },
    })
    const from = vi.fn().mockReturnValue({ createSignedUrl })

    await expect(
      createPrivateSignedUrl(
        { storage: { from } },
        'knowledge-files',
        `${workspaceId}/${userId}/${resourceId}/guide.pdf`,
      ),
    ).rejects.toThrow('파일 열기 링크를 만들 수 없습니다.')
  })

  it('normalizes rejected provider promises without leaking details', async () => {
    const createSignedUrl = vi
      .fn()
      .mockRejectedValue(new Error('PRIVATE_PROVIDER_DETAIL'))
    const from = vi.fn().mockReturnValue({ createSignedUrl })

    const request = createPrivateSignedUrl(
      { storage: { from } },
      'content-media',
      `${workspaceId}/${userId}/${resourceId}/photo.webp`,
    )

    await expect(request).rejects.toThrow('파일 열기 링크를 만들 수 없습니다.')
    await expect(request).rejects.not.toThrow('PRIVATE_PROVIDER_DETAIL')
  })

  it('ignores caller poisoning of Set.prototype.has', async () => {
    const originalHas = Set.prototype.has
    const from = vi.fn()
    try {
      Set.prototype.has = () => true
      await expect(
        createPrivateSignedUrl(
          { storage: { from } },
          'public-assets' as 'content-media',
          `${workspaceId}/${userId}/${resourceId}/photo.webp`,
        ),
      ).rejects.toThrow('허용되지 않은 저장소입니다.')
      expect(from).not.toHaveBeenCalled()
    } finally {
      Set.prototype.has = originalHas
    }
  })
})
