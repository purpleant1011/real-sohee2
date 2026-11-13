import { describe, expect, it, vi } from 'vitest'
import {
  getProfileImageUrl,
  removeProfileImage,
  replaceProfileImage,
  type ProfileImageGateway,
} from './profile-image-repository'

const userId = '10000000-0000-4000-8000-000000000001'
const resourceId = '30000000-0000-4000-8000-000000000001'
const oldPath = `${userId}/20000000-0000-4000-8000-000000000001/avatar.webp`
const newPath = `${userId}/${resourceId}/avatar.png`

function pngFile(): File {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return {
    name: 'profile.png',
    type: 'image/png',
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer,
  } as File
}

function gateway(overrides: Partial<ProfileImageGateway> = {}): ProfileImageGateway {
  return {
    getProfile: vi.fn().mockResolvedValue({
      data: { avatar_bucket: 'profile-images', avatar_path: oldPath, avatar_version: 2 },
      error: null,
    }),
    uploadObject: vi.fn().mockResolvedValue({ error: null }),
    updateProfile: vi.fn().mockResolvedValue({ data: { avatar_version: 3 }, error: null }),
    removeObject: vi.fn().mockResolvedValue({ error: null }),
    createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.example/avatar' }, error: null }),
    ...overrides,
  }
}

describe('profile image replacement', () => {
  it('uploads a new immutable object, updates the profile, then removes the old object', async () => {
    const calls: string[] = []
    const store = gateway({
      getProfile: vi.fn(async () => {
        calls.push('read')
        return { data: { avatar_bucket: 'profile-images' as const, avatar_path: oldPath, avatar_version: 2 }, error: null }
      }),
      uploadObject: vi.fn(async (_path, _body, options) => {
        calls.push(`upload:${String(options.upsert)}`)
        return { error: null }
      }),
      updateProfile: vi.fn(async (input) => {
        calls.push(`update:${input.avatarVersion}`)
        return { data: { avatar_version: input.avatarVersion }, error: null }
      }),
      removeObject: vi.fn(async (path) => {
        calls.push(`remove:${path}`)
        return { error: null }
      }),
    })

    await expect(replaceProfileImage({ userId, resourceId, file: pngFile() }, store)).resolves.toEqual({
      ok: true,
      avatarPath: newPath,
      avatarVersion: 3,
    })
    expect(calls).toEqual(['read', 'upload:false', 'update:3', `remove:${oldPath}`])
  })

  it('removes the new object and preserves the old profile when the row update fails', async () => {
    const removeObject = vi.fn().mockResolvedValue({ error: null })
    const store = gateway({
      updateProfile: vi.fn().mockResolvedValue({ data: null, error: { message: 'PRIVATE_DB_DETAIL' } }),
      removeObject,
    })

    const result = await replaceProfileImage({ userId, resourceId, file: pngFile() }, store)

    expect(result).toEqual({
      ok: false,
      error: { code: 'PROFILE_IMAGE_SAVE_FAILED', message: '사진을 저장하지 못했어요. 기존 사진은 그대로 유지됩니다.' },
    })
    expect(removeObject).toHaveBeenCalledWith(newPath)
    expect(JSON.stringify(result)).not.toContain('PRIVATE_DB_DETAIL')
  })

  it('keeps the new profile successful when only old-object cleanup fails', async () => {
    const store = gateway({
      removeObject: vi.fn().mockResolvedValue({ error: { message: 'PRIVATE_STORAGE_DETAIL' } }),
    })

    await expect(replaceProfileImage({ userId, resourceId, file: pngFile() }, store)).resolves.toEqual({
      ok: true,
      avatarPath: newPath,
      avatarVersion: 3,
    })
  })
})

describe('profile image removal and reading', () => {
  it('clears profile metadata before deleting the previous object', async () => {
    const calls: string[] = []
    const store = gateway({
      updateProfile: vi.fn(async (input) => {
        calls.push(`update:${String(input.avatarPath)}`)
        return { data: { avatar_version: input.avatarVersion }, error: null }
      }),
      removeObject: vi.fn(async (path) => {
        calls.push(`remove:${path}`)
        return { error: null }
      }),
    })

    await expect(removeProfileImage(userId, store)).resolves.toEqual({
      ok: true,
      avatarPath: null,
      avatarVersion: 3,
    })
    expect(calls).toEqual(['update:null', `remove:${oldPath}`])
  })

  it('returns a signed URL only for the current stored object', async () => {
    const store = gateway()

    await expect(getProfileImageUrl(userId, store)).resolves.toBe('https://signed.example/avatar')
    expect(store.createSignedUrl).toHaveBeenCalledWith(oldPath, 60)
  })

  it('falls back to null without leaking signed-url provider errors', async () => {
    const store = gateway({
      createSignedUrl: vi.fn().mockRejectedValue(new Error('PRIVATE_SIGNED_URL_DETAIL')),
    })

    await expect(getProfileImageUrl(userId, store)).resolves.toBeNull()
  })
})
