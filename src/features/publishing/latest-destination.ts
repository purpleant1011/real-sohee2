import { z } from 'zod'

const uuidSchema = z.string().uuid()

export async function getLatestPublishedDestinationUrl(
  workspaceId: string,
  contentId: string,
  client?: unknown,
): Promise<string | null> {
  const parsedWorkspace = uuidSchema.safeParse(workspaceId)
  const parsedContent = uuidSchema.safeParse(contentId)
  if (!parsedWorkspace.success || !parsedContent.success) {
    return null
  }

  try {
    const supabase = client
      ? (client as any)
      : await (await import('@/lib/supabase/server')).createServerSupabaseClient()

    const schedulesRes = await supabase
      .from('schedules')
      .select('id')
      .eq('workspace_id', parsedWorkspace.data)
      .eq('content_id', parsedContent.data)
      .limit(20)

    if (schedulesRes.error || !Array.isArray(schedulesRes.data) || schedulesRes.data.length === 0) {
      return null
    }

    const scheduleIds = schedulesRes.data.map((row: { id: string }) => row.id)

    const attemptsRes = await supabase
      .from('publish_attempts')
      .select('id, finished_at')
      .eq('workspace_id', parsedWorkspace.data)
      .in('schedule_id', scheduleIds)
      .eq('status', 'succeeded')
      .order('finished_at', { ascending: false, nullsFirst: false })
      .limit(1)

    if (attemptsRes.error || !Array.isArray(attemptsRes.data) || attemptsRes.data.length === 0) {
      return null
    }

    const latestAttemptId = attemptsRes.data[0]?.id
    if (!latestAttemptId) {
      return null
    }

    const trackingRes = await supabase
      .from('social_post_tracking')
      .select('destination_url')
      .eq('workspace_id', parsedWorkspace.data)
      .eq('publish_attempt_id', latestAttemptId)
      .maybeSingle()

    if (trackingRes.error || !trackingRes.data) {
      return null
    }

    const destinationUrl = trackingRes.data.destination_url
    if (typeof destinationUrl !== 'string') {
      return null
    }

    const trimmed = destinationUrl.trim()
    if (!trimmed.startsWith('https://')) {
      return null
    }

    try {
      const parsed = new URL(trimmed)
      if (parsed.protocol !== 'https:') {
        return null
      }
    } catch {
      return null
    }

    return trimmed
  } catch {
    return null
  }
}
