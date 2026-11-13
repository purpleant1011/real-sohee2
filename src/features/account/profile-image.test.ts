import { describe, expect, it } from 'vitest'
import {
  buildProfileImagePath,
  PROFILE_IMAGE_MAX_BYTES,
  snapshotProfileImage,
} from './profile-image'

const userId = '10000000-0000-4000-8000-000000000001'
const resourceId = '30000000-0000-4000-8000-000000000001'

function createFile(bytes: number[], type: string, name = 'avatar.png'): File {
  const value = new Uint8Array(bytes)
  return {
    name,
    type,
    size: value.byteLength,
    slice(start?: number, end?: number) {
      const sliced = value.slice(start, end)
      return { arrayBuffer: async () => sliced.buffer } as Blob
    },
    arrayBuffer: async () => value.buffer,
  } as File
}

describe('profile image validation', () => {
  it('builds an immutable user-owned path with a fixed filename', () => {
    expect(buildProfileImagePath({ userId, resourceId, extension: 'png' })).toBe(
      `${userId}/${resourceId}/avatar.png`,
    )
  })

  it('rejects malformed path identifiers before building a storage path', () => {
    expect(() => buildProfileImagePath({ userId: '../other', resourceId, extension: 'png' }))
      .toThrow('프로필 사진 경로가 올바르지 않습니다.')
  })

  it('snapshots and validates the exact PNG bytes that will be uploaded', async () => {
    const result = await snapshotProfileImage(createFile(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      'image/png',
    ))

    expect(result).toMatchObject({
      ok: true,
      extension: 'png',
      mimeType: 'image/png',
    })
    if (result.ok) {
      expect(result.body).toBeInstanceOf(Blob)
      expect(result.body.size).toBe(8)
    }
  })

  it('rejects an image larger than 5MB before reading its body', async () => {
    let bodyRead = false
    const oversized = {
      name: 'large.png',
      type: 'image/png',
      size: PROFILE_IMAGE_MAX_BYTES + 1,
      arrayBuffer: async () => {
        bodyRead = true
        return new ArrayBuffer(0)
      },
    } as File

    await expect(snapshotProfileImage(oversized)).resolves.toEqual({
      ok: false,
      error: { code: 'PROFILE_IMAGE_TOO_LARGE', message: '5MB 이하의 사진을 선택해 주세요.' },
    })
    expect(bodyRead).toBe(false)
  })

  it('rejects MIME and byte-signature mismatches', async () => {
    await expect(snapshotProfileImage(createFile(
      [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
      'image/png',
    ))).resolves.toMatchObject({
      ok: false,
      error: { code: 'PROFILE_IMAGE_SIGNATURE_INVALID' },
    })
  })

  it('rejects empty and unsupported files with safe copy', async () => {
    await expect(snapshotProfileImage(createFile([], 'image/png'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'PROFILE_IMAGE_EMPTY' },
    })
    await expect(snapshotProfileImage(createFile([1], 'image/gif', 'avatar.gif'))).resolves.toEqual({
      ok: false,
      error: { code: 'PROFILE_IMAGE_TYPE_INVALID', message: 'JPEG, PNG 또는 WebP 사진을 선택해 주세요.' },
    })
  })
})
