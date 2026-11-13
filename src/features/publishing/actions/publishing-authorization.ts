import 'server-only'

import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const uuid = z.string().uuid()

export async function getAuthorizedPublisher(workspaceId: string): Promise<string | null> {
  const supabase = await createServerSupabaseClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  const user = uuid.safeParse(userData?.user?.id)
  if (userError || !user.success) return null

  const { data: membership, error } = await supabase.from('workspace_members')
    .select('role, status')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.data)
    .maybeSingle()
  if (error || membership?.status !== 'active' || !['owner', 'manager'].includes(membership.role)) return null
  return user.data
}

export async function getAuthorizedOwner(workspaceId: string): Promise<string | null> {
  const supabase = await createServerSupabaseClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  const user = uuid.safeParse(userData?.user?.id)
  if (userError || !user.success) return null

  const { data: membership, error } = await supabase.from('workspace_members')
    .select('role, status')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.data)
    .maybeSingle()
  if (error || membership?.status !== 'active' || membership.role !== 'owner') return null
  return user.data
}
