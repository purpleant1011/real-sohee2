import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { buildProfileImagePath, snapshotProfileImage } from './profile-image'

export const PROFILE_SIGNED_URL_SECONDS = 60

type StoredProfile = Readonly<{
  avatar_bucket: 'profile-images' | null
  avatar_path: string | null
  avatar_version: number
}>

type ProviderResult = Readonly<{ error: unknown }>

export type ProfileImageGateway = Readonly<{
  getProfile(userId: string): Promise<Readonly<{ data: StoredProfile | null; error: unknown }>>
  uploadObject(path: string, body: Blob, options: Readonly<{ contentType: string; upsert: false }>): Promise<ProviderResult>
  updateProfile(input: Readonly<{
    userId: string
    expectedVersion: number
    avatarBucket: 'profile-images' | null
    avatarPath: string | null
    avatarVersion: number
  }>): Promise<Readonly<{ data: { avatar_version: number } | null; error: unknown }>>
  removeObject(path: string): Promise<ProviderResult>
  createSignedUrl(path: string, expiresIn: number): Promise<Readonly<{
    data: { signedUrl: string } | null
    error: unknown
  }>>
}>

export type ProfileImageResult =
  | Readonly<{ ok: true; avatarPath: string | null; avatarVersion: number }>
  | Readonly<{ ok: false; error: { code: string; message: string } }>

const saveFailure = Object.freeze({
  ok: false as const,
  error: Object.freeze({
    code: 'PROFILE_IMAGE_SAVE_FAILED',
    message: '사진을 저장하지 못했어요. 기존 사진은 그대로 유지됩니다.',
  }),
})

const deleteFailure = Object.freeze({
  ok: false as const,
  error: Object.freeze({
    code: 'PROFILE_IMAGE_DELETE_FAILED',
    message: '사진을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.',
  }),
})

export async function replaceProfileImage(
  input: Readonly<{ userId: string; resourceId: string; file: File }>,
  gateway: ProfileImageGateway,
): Promise<ProfileImageResult> {
  const snapshot = await snapshotProfileImage(input.file)
  if (!snapshot.ok) return snapshot

  let newPath: string
  try {
    newPath = buildProfileImagePath({
      userId: input.userId,
      resourceId: input.resourceId,
      extension: snapshot.extension,
    })
    const current = await gateway.getProfile(input.userId)
    if (current.error || !current.data) return saveFailure

    const uploaded = await gateway.uploadObject(newPath, snapshot.body, {
      contentType: snapshot.mimeType,
      upsert: false,
    })
    if (uploaded.error) return saveFailure

    const nextVersion = current.data.avatar_version + 1
    const updated = await gateway.updateProfile({
      userId: input.userId,
      expectedVersion: current.data.avatar_version,
      avatarBucket: 'profile-images',
      avatarPath: newPath,
      avatarVersion: nextVersion,
    })
    if (updated.error || !updated.data) {
      await bestEffort(() => gateway.removeObject(newPath))
      return saveFailure
    }

    if (current.data.avatar_path && current.data.avatar_path !== newPath) {
      await bestEffort(() => gateway.removeObject(current.data?.avatar_path ?? ''))
    }
    return Object.freeze({ ok: true, avatarPath: newPath, avatarVersion: updated.data.avatar_version })
  } catch {
    return saveFailure
  }
}

export async function removeProfileImage(
  userId: string,
  gateway: ProfileImageGateway,
): Promise<ProfileImageResult> {
  try {
    const current = await gateway.getProfile(userId)
    if (current.error || !current.data) return deleteFailure
    if (!current.data.avatar_path) {
      return Object.freeze({ ok: true, avatarPath: null, avatarVersion: current.data.avatar_version })
    }

    const nextVersion = current.data.avatar_version + 1
    const updated = await gateway.updateProfile({
      userId,
      expectedVersion: current.data.avatar_version,
      avatarBucket: null,
      avatarPath: null,
      avatarVersion: nextVersion,
    })
    if (updated.error || !updated.data) return deleteFailure
    await bestEffort(() => gateway.removeObject(current.data?.avatar_path ?? ''))
    return Object.freeze({ ok: true, avatarPath: null, avatarVersion: updated.data.avatar_version })
  } catch {
    return deleteFailure
  }
}

export async function getProfileImageUrl(
  userId: string,
  gateway: ProfileImageGateway,
): Promise<string | null> {
  try {
    const current = await gateway.getProfile(userId)
    if (current.error || current.data?.avatar_bucket !== 'profile-images' || !current.data.avatar_path) {
      return null
    }
    const signed = await gateway.createSignedUrl(current.data.avatar_path, PROFILE_SIGNED_URL_SECONDS)
    return signed.error || typeof signed.data?.signedUrl !== 'string' ? null : signed.data.signedUrl
  } catch {
    return null
  }
}

export function createProfileImageGateway(client: SupabaseClient<Database>): ProfileImageGateway {
  return {
    async getProfile(userId) {
      const result = await client.from('profiles')
        .select('avatar_bucket, avatar_path, avatar_version')
        .eq('id', userId)
        .maybeSingle()
      return { data: result.data as StoredProfile | null, error: result.error }
    },
    async uploadObject(path, body, options) {
      const { error } = await client.storage.from('profile-images').upload(path, body, options)
      return { error }
    },
    async updateProfile(input) {
      const result = await client.from('profiles')
        .update({
          avatar_bucket: input.avatarBucket,
          avatar_path: input.avatarPath,
          avatar_version: input.avatarVersion,
        })
        .eq('id', input.userId)
        .eq('avatar_version', input.expectedVersion)
        .select('avatar_version')
        .maybeSingle()
      return { data: result.data, error: result.error }
    },
    async removeObject(path) {
      const { error } = await client.storage.from('profile-images').remove([path])
      return { error }
    },
    async createSignedUrl(path, expiresIn) {
      return client.storage.from('profile-images').createSignedUrl(path, expiresIn)
    },
  }
}

async function bestEffort(operation: () => Promise<unknown>) {
  try {
    await operation()
  } catch {
    // Metadata already defines the visible state; orphan cleanup is recoverable.
  }
}
