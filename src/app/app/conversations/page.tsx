import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { resolveCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { ConversationClient } from '@/features/chat/conversation-client'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { V086ConversationWorkspace } from '@/features/chat/v086-conversation-workspace'
import { listConversationThreads, type ConversationThreadPage } from '@/features/chat/thread-repository'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { resolveConversationWorkRef, type ConversationWorkRef } from '@/features/chat/conversation-work-ref'
import { isConversationWorkbenchEnabled } from '@/features/chat/conversation-rollout'

export const metadata: Metadata = {
  title: '소희와 일하기 | 소희',
  description: '대화로 업무를 맡기고, 작업물과 실제 진행 상황을 함께 확인하세요.',
}

export default async function ConversationsPage({ searchParams }: {
  searchParams: Promise<{ view?: string; workRef?: string }>
}) {
  const resolution = await resolveCurrentWorkspaceContext()
  if (resolution.status === 'expired') redirect('/login?next=%2Fapp%2Fconversations')
  if (resolution.status === 'missing') redirect('/start')
  if (resolution.status !== 'ready') {
    return <section className="rounded-2xl border border-border bg-card p-6 text-card-foreground" role="alert">
      <h1 className="text-lg font-semibold">대화를 열지 못했어요</h1>
      <p>{resolution.status === 'forbidden' ? '이 가게의 대화에 접근할 권한이 없어요.' : '가게 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.'}</p>
    </section>
  }
  const workspace = resolution.context
  const { view, workRef } = await searchParams
  const enabled = isConversationWorkbenchEnabled(workspace.workspaceId)
  if (!enabled && workRef) return <section role="alert"><h1>이 가게에서는 새 대화 검토를 아직 열지 않았어요</h1><Link href="/app/content">원래 콘텐츠 화면에서 이어서 진행</Link></section>
  if (view === 'legacy' || !enabled) {
    return <><Link className="inline-flex min-h-11 items-center text-primary" href="/app/conversations">전체 화면 대화로 돌아가기</Link><V086ConversationWorkspace /></>
  }

  let workContext: ConversationWorkRef | null = null
  if (workRef) {
    const client = await createServerSupabaseClient()
    const user = await client.auth.getUser()
    if (!user.error && user.data.user) workContext = await resolveConversationWorkRef(client as unknown as import('@/features/chat/conversation-authority').ConversationAuthorityDatabase, { workspaceId: workspace.workspaceId, userId: user.data.user.id, workRef })
    if (!workContext) return <section role="alert"><h1>선택한 원고를 이어서 열지 못했어요</h1><p>권한이 없거나 원고가 다른 곳에서 변경됐어요. 원래 화면에서 최신 버전을 다시 선택해 주세요.</p><Link href="/app/content">콘텐츠로 돌아가기</Link></section>
  }
  let threadPage: ConversationThreadPage = { items: [], hasMore: false }
  let initialThreadLoadFailed = false
  try {
    const client = await createServerSupabaseClient()
    threadPage = await listConversationThreads({ client, workspaceId: workspace.workspaceId, page: 0, limit: 20 })
  } catch {
    initialThreadLoadFailed = true
  }

  return <V088AppShell workspaceId={workspace.workspaceId}>
    <ConversationClient
      backgroundJobs
      canManageThreads={workspace.role !== 'viewer'}
      hasMoreThreads={threadPage.hasMore}
      initialMessages={[]}
      initialThreadLoadFailed={initialThreadLoadFailed}
      initialThreads={threadPage.items}
      key={`${workspace.workspaceId}:${workRef ?? ''}`}
      workContext={workContext}
      readOnly={workspace.role === 'viewer'}
      threadId={null}
      workspaceId={workspace.workspaceId}
    />
    <Link className="hidden" aria-hidden="true" tabIndex={-1} href="/app/conversations?view=legacy" style={{ marginBottom: 'var(--conversation-scroll-clearance, 4rem)' }}>기존 대화 작업 화면 열기</Link>
  </V088AppShell>
}
