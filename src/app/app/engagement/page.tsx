import { redirect } from 'next/navigation'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { SupabaseEngagementRepository } from '@/features/engagement/repository'
import { EngagementEntry } from './engagement-entry'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function EngagementPage() {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) {
    redirect('/app/onboarding')
    return null
  }

  let instagramPolicy = null
  let threadsPolicy = null
  try {
    const supabase = await createServerSupabaseClient()
    const repo = new SupabaseEngagementRepository(supabase as any)
    const [ig, th] = await Promise.all([
      repo.findPolicy(workspace.workspaceId, 'instagram'),
      repo.findPolicy(workspace.workspaceId, 'threads'),
    ])
    instagramPolicy = ig
    threadsPolicy = th
  } catch (err) {
    console.warn('[EngagementPage] Failed to load server-side policy:', err)
  }

  return (
    <EngagementEntry
      workspaceId={workspace.workspaceId}
      initialPolicies={{
        instagram: instagramPolicy,
        threads: threadsPolicy,
      }}
    />
  )
}
