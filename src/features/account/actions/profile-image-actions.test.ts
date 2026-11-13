import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  createGateway: vi.fn(),
  replace: vi.fn(),
  remove: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ auth: { getClaims: mocks.getClaims } })),
}))
vi.mock('../profile-image-repository', () => ({
  createProfileImageGateway: mocks.createGateway,
  replaceProfileImage: mocks.replace,
  removeProfileImage: mocks.remove,
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import {
  deleteProfileImageAction,
  initialProfileImageActionState,
  saveProfileImageAction,
} from './profile-image-actions'

const userId = '10000000-0000-4000-8000-000000000001'

describe('profile image actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: userId } }, error: null })
    mocks.createGateway.mockReturnValue({ gateway: true })
  })

  it('authenticates on the server and saves only the uploaded file for the current user', async () => {
    mocks.replace.mockResolvedValue({ ok: true, avatarPath: `${userId}/resource/avatar.png`, avatarVersion: 1 })
    const file = new File(['profile'], 'profile.png', { type: 'image/png' })
    const formData = new FormData()
    formData.set('profileImage', file)
    formData.set('userId', '20000000-0000-4000-8000-000000000099')

    await expect(saveProfileImageAction(initialProfileImageActionState, formData)).resolves.toEqual({
      status: 'success',
      message: '프로필 사진을 저장했어요.',
    })

    expect(mocks.replace).toHaveBeenCalledWith(expect.objectContaining({ userId, file }), { gateway: true })
    expect(mocks.replace.mock.calls[0]?.[0].resourceId).toMatch(/^[0-9a-f-]{36}$/u)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app', 'layout')
  })

  it('rejects missing authentication before creating a repository', async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: {} }, error: null })
    const formData = new FormData()
    formData.set('profileImage', new File(['profile'], 'profile.png', { type: 'image/png' }))

    await expect(saveProfileImageAction(initialProfileImageActionState, formData)).resolves.toEqual({
      status: 'error',
      message: '로그인 정보를 확인할 수 없어요. 다시 로그인해 주세요.',
    })
    expect(mocks.createGateway).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('returns the domain error without revalidating a failed save', async () => {
    mocks.replace.mockResolvedValue({
      ok: false,
      error: { code: 'PROFILE_IMAGE_TOO_LARGE', message: '5MB 이하의 사진을 선택해 주세요.' },
    })
    const formData = new FormData()
    formData.set('profileImage', new File(['profile'], 'profile.png', { type: 'image/png' }))

    await expect(saveProfileImageAction(initialProfileImageActionState, formData)).resolves.toEqual({
      status: 'error',
      message: '5MB 이하의 사진을 선택해 주세요.',
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('authenticates and removes only the current user profile image', async () => {
    mocks.remove.mockResolvedValue({ ok: true, avatarPath: null, avatarVersion: 2 })

    await expect(deleteProfileImageAction(initialProfileImageActionState, new FormData())).resolves.toEqual({
      status: 'success',
      message: '프로필 사진을 삭제했어요.',
    })
    expect(mocks.remove).toHaveBeenCalledWith(userId, { gateway: true })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app', 'layout')
  })
})
