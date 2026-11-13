'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'

export function NotificationsRealtime({ workspaceId, userId }: Readonly<{ workspaceId: string; userId: string }>) {
  const router = useRouter()
  useEffect(() => {
    let supabase: ReturnType<typeof createBrowserSupabaseClient>
    try {
      supabase = createBrowserSupabaseClient()
    } catch {
      return
    }
    const channel = supabase.channel(`notifications:${workspaceId}:${userId}`).on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload) => {
        const row = (payload.new ?? payload.old) as { workspace_id?: unknown }
        if (row.workspace_id === workspaceId) router.refresh()
      },
    ).subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [router, userId, workspaceId])
  return null
}
