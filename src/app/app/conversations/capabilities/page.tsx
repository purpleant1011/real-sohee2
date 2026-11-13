import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { resolveCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { ConversationOperationCatalogClient } from '@/features/chat/conversation-operation-catalog-client'
import { loadAuthorizedConversationCatalog } from '@/features/chat/conversation-operation-catalog-request.server'
import { isResponse } from '@/features/quick-start/route-auth'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: '소희가 할 수 있는 일 | 소희' }

export default async function ConversationCapabilitiesPage() {
  const resolution = await resolveCurrentWorkspaceContext()
  if (resolution.status === 'expired') redirect('/login?next=%2Fapp%2Fconversations%2Fcapabilities')
  if (resolution.status === 'missing') redirect('/start')
  if (resolution.status !== 'ready') return <Alert><AlertTitle>업무 목록을 열지 못했어요</AlertTitle><AlertDescription>현재 가게와 접근 권한을 다시 확인해 주세요.</AlertDescription></Alert>
  const catalog = await loadAuthorizedConversationCatalog(resolution.context.workspaceId)
  return <V088AppShell workspaceId={resolution.context.workspaceId}>{isResponse(catalog)
    ? <Alert><AlertTitle>업무 준비 상태를 확인하지 못했어요</AlertTitle><AlertDescription>조회 실패를 연결 없음으로 표시하지 않았어요. 잠시 후 다시 열어 주세요.</AlertDescription></Alert>
    : <ConversationOperationCatalogClient catalog={catalog} />}</V088AppShell>
}
