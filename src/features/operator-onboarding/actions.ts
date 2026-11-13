'use server'

import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { passwordUpdateSchema } from '@/features/auth/schemas'
import { getCurrentOperatorSetupContext } from './setup-context'

const requestId = 'admin-setup-password'
const inputSchema = z.object({
  password: passwordUpdateSchema.shape.password,
  passwordConfirmation: z.string(),
}).strict()

function failure(message: string): ActionResult<{ code: 'password_recorded' }> {
  return { error: { message, requestId } }
}

function mfaFailure(message: string): ActionResult<{ code: 'mfa_activated' }> {
  return { error: { message, requestId: 'admin-setup-mfa' } }
}

export async function activateInvitedOperatorAction(): Promise<ActionResult<{ code: 'mfa_activated' }>> {
  try {
    const supabase = await createServerSupabaseClient()
    const { error } = await supabase.rpc('activate_current_invited_operator')
    if (error) return mfaFailure('관리자 활성화를 완료하지 못했습니다. 다시 시도해 주세요.')
    const context = await getCurrentOperatorSetupContext()
    if (!context || context.status !== 'active' || context.currentAal !== 'aal2') {
      return mfaFailure('관리자 활성화 상태를 확인하지 못했습니다. 다시 시도해 주세요.')
    }
    return { data: { code: 'mfa_activated' } }
  } catch {
    return mfaFailure('관리자 활성화를 완료하지 못했습니다. 다시 시도해 주세요.')
  }
}

export async function updateInvitedOperatorPasswordAction(
  input: unknown,
): Promise<ActionResult<{ code: 'password_recorded' }>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return failure('비밀번호 설정 내용을 확인해 주세요.')
  if (parsed.data.password !== parsed.data.passwordConfirmation) {
    return failure('비밀번호 확인이 일치하지 않습니다.')
  }

  try {
    const supabase = await createServerSupabaseClient()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) return failure('로그인 후 다시 시도해 주세요.')

    const { error: updateError } = await supabase.auth.updateUser({ password: parsed.data.password })
    if (updateError) return failure('비밀번호를 설정하지 못했습니다. 다시 시도해 주세요.')

    const { error: recordError } = await supabase.rpc('record_current_invited_operator_password_set')
    if (recordError) return failure('비밀번호 설정을 완료하지 못했습니다. 다시 시도해 주세요.')

    return { data: { code: 'password_recorded' } }
  } catch {
    return failure('비밀번호 설정을 완료하지 못했습니다. 다시 시도해 주세요.')
  }
}
