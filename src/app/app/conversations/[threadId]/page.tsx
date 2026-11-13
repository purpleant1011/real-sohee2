import { notFound, redirect } from 'next/navigation'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { ConversationClient } from '@/features/chat/conversation-client'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import {
  createSupabaseConversationArtifactGateway,
  listConversationArtifactsForMessages,
} from '@/features/chat/conversation-artifact-repository'
import { listConversationMessages } from '@/features/chat/repository'
import { listConversationThreads } from '@/features/chat/thread-repository'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { resolveConversationWorkRef, type ConversationWorkRef } from '@/features/chat/conversation-work-ref'
import { isConversationWorkbenchEnabled } from '@/features/chat/conversation-rollout'

export default async function ConversationPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ threadId: string }>
  searchParams?: Promise<{ workRef?: string }>
}>) {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) redirect('/app/onboarding')
  const { threadId } = await params
  const client = await createServerSupabaseClient()
  const thread = await client.from('conversation_threads')
    .select('id, workspace_id, title, status, last_message_at, created_at, updated_at')
    .eq('workspace_id', workspace.workspaceId)
    .eq('id', threadId)
    .maybeSingle()
  if (thread.error || !thread.data) notFound()
  const enabled = isConversationWorkbenchEnabled(workspace.workspaceId)
  const workRef = (await searchParams)?.workRef
  if (workRef && !enabled) notFound()
  let workContext: ConversationWorkRef | null = null
  if (workRef) {
    const user = await client.auth.getUser()
    if (!user.error && user.data.user) workContext = await resolveConversationWorkRef(client as unknown as import('@/features/chat/conversation-authority').ConversationAuthorityDatabase, { workspaceId: workspace.workspaceId, userId: user.data.user.id, workRef })
    if (!workContext) notFound()
  }

  const [messages, threadPage] = await Promise.all([
    listConversationMessages({
      client,
      workspaceId: workspace.workspaceId,
      threadId,
      limit: 50,
    }),
    listConversationThreads({ client, workspaceId: workspace.workspaceId, page: 0, limit: 20 }),
  ])
  const artifactGateway = createSupabaseConversationArtifactGateway(client)
  const initialConversationArtifacts = await listConversationArtifactsForMessages({
    workspaceId: workspace.workspaceId,
    messageIds: messages
      .filter((message) => (message.artifacts?.length ?? 0) > 0)
      .map((message) => message.id),
  }, artifactGateway)
  const conversation = (
    <ConversationClient
      backgroundJobs
      canManageThreads={workspace.role !== 'viewer'}
      currentThread={{
        id: thread.data.id,
        workspaceId: thread.data.workspace_id,
        title: thread.data.title,
        status: thread.data.status as 'active' | 'archived',
        lastMessageAt: thread.data.last_message_at,
        createdAt: thread.data.created_at,
        updatedAt: thread.data.updated_at,
      }}
      hasMoreThreads={threadPage.hasMore}
      initialConversationArtifacts={initialConversationArtifacts}
      initialMessages={[...messages].reverse()}
      initialThreads={threadPage.items}
      readOnly={workspace.role === 'viewer'}
      key={`${threadId}:${workRef ?? ''}`}
      workContext={workContext}
      workModesEnabled={enabled}
      threadId={threadId}
      workspaceId={workspace.workspaceId}
    />
  )
  return enabled ? <V088AppShell workspaceId={workspace.workspaceId}>{conversation}</V088AppShell> : conversation
}
