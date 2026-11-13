import { createAdminSupabaseClient } from '@/lib/supabase/admin'

/** Best-effort: the database enforces at least 1 connected SNS channel (Instagram or Threads) and exactly-once credit issuance. */
export async function grantConnectedSignupCredits(userId: string, workspaceId: string): Promise<void> {
  try {
    const { error } = await (createAdminSupabaseClient() as any).rpc('ensure_signup_starter_credits', {
      p_user_id: userId,
      p_workspace_id: workspaceId,
    })
    if (error) console.warn('[channel oauth] starter credit grant failed:', error)
  } catch (error) {
    console.warn('[channel oauth] starter credit grant failed:', error)
  }
}
