import { createServerSupabaseClient } from '@/lib/supabase/server'

export type ManagerAuth = Readonly<{ userId: string; role: 'owner' | 'manager' }>

/** 로그인한 소유자·관리자만 통과. 실패하면 사용자에게 보여줄 문구를 돌려준다. */
export async function authorizeManager(workspaceId: string): Promise<ManagerAuth | { message: string }> {
  const supabase = await createServerSupabaseClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  const userId = userData?.user?.id
  if (userError || typeof userId !== 'string') return { message: '로그인 후 다시 시도해 주세요.' }
  const { data: membership, error } = await supabase
    .from('workspace_members')
    .select('role, status')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error || membership?.status !== 'active' || (membership.role !== 'owner' && membership.role !== 'manager')) {
    return { message: '소유자 또는 관리자만 이미지 스타일을 만들 수 있어요.' }
  }
  return { userId, role: membership.role }
}
