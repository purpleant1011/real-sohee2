'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  createProfileImageGateway,
  removeProfileImage,
  replaceProfileImage,
} from '../profile-image-repository'

export type ProfileImageActionState = Readonly<{
  status: 'idle' | 'success' | 'error'
  message: string
}>

export const initialProfileImageActionState: ProfileImageActionState = Object.freeze({
  status: 'idle',
  message: '',
})

const authFailure = Object.freeze({
  status: 'error' as const,
  message: '로그인 정보를 확인할 수 없어요. 다시 로그인해 주세요.',
})

export async function saveProfileImageAction(
  _previousState: ProfileImageActionState,
  formData: FormData,
): Promise<ProfileImageActionState> {
  try {
    const supabase = await createServerSupabaseClient()
    const { data, error } = await supabase.auth.getClaims()
    const userId = data?.claims?.sub
    if (error || typeof userId !== 'string' || userId.length === 0) return authFailure

    const file = formData.get('profileImage')
    if (!(file instanceof File)) {
      return { status: 'error', message: '저장할 프로필 사진을 선택해 주세요.' }
    }
    const result = await replaceProfileImage(
      { userId, resourceId: crypto.randomUUID(), file },
      createProfileImageGateway(supabase),
    )
    if (!result.ok) return { status: 'error', message: result.error.message }
    revalidatePath('/app', 'layout')
    return { status: 'success', message: '프로필 사진을 저장했어요.' }
  } catch {
    return { status: 'error', message: '사진을 저장하지 못했어요. 기존 사진은 그대로 유지됩니다.' }
  }
}

export async function deleteProfileImageAction(
  _previousState: ProfileImageActionState,
  _formData: FormData,
): Promise<ProfileImageActionState> {
  void _previousState
  void _formData
  try {
    const supabase = await createServerSupabaseClient()
    const { data, error } = await supabase.auth.getClaims()
    const userId = data?.claims?.sub
    if (error || typeof userId !== 'string' || userId.length === 0) return authFailure

    const result = await removeProfileImage(userId, createProfileImageGateway(supabase))
    if (!result.ok) return { status: 'error', message: result.error.message }
    revalidatePath('/app', 'layout')
    return { status: 'success', message: '프로필 사진을 삭제했어요.' }
  } catch {
    return { status: 'error', message: '사진을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.' }
  }
}
