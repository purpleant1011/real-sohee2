'use server'

import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'

import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export type PairingCodeState = Readonly<{
  code: string | null
  expiresAt: string | null
  error: string | null
}>

const initialState: PairingCodeState = Object.freeze({ code: null, expiresAt: null, error: null })

export async function createPairingCodeAction(
  previous: PairingCodeState = initialState,
): Promise<PairingCodeState> {
  void previous
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace || (workspace.role !== 'owner' && workspace.role !== 'manager')) {
    return { code: null, expiresAt: null, error: '작업공간 소유자와 관리자만 기기를 연결할 수 있어요.' }
  }
  const client = await createServerSupabaseClient()
  const { data, error } = await client.auth.getUser()
  const userId = data.user?.id
  if (error || !z.string().uuid().safeParse(userId).success) {
    return { code: null, expiresAt: null, error: '로그인 후 다시 시도해 주세요.' }
  }
  const code = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + 10 * 60 * 1_000).toISOString()
  const admin = createAdminSupabaseClient() as unknown as {
    rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
  }
  const result = await admin.rpc('create_connector_pairing_code', {
    p_workspace_id: workspace.workspaceId,
    p_actor_user_id: userId,
    p_code_digest: createHash('sha256').update(code, 'utf8').digest('hex'),
    p_expires_at: expiresAt,
  })
  if (result.error || !z.string().uuid().safeParse(result.data).success) {
    return { code: null, expiresAt: null, error: '연결 코드를 만들지 못했어요. 잠시 후 다시 시도해 주세요.' }
  }
  return Object.freeze({ code, expiresAt, error: null })
}
