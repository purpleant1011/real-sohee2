'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { WorkspaceProvider } from '@/components/workspace/workspace-provider'
import { ThemeProvider, useTheme } from '@/components/theme-provider'
import { ChatPanelProvider, useChatPanel } from '@/features/agent-dock/chat-panel-store'
import { ConversationShell } from '@/features/chat/conversation-shell'
import { ContentInterviewCard } from '@/features/chat/content-interview-card'
import { contentInterviewView, createInitialContentInterview } from '@/features/chat/content-interview'
import { buildConversationOperationCatalog } from '@/features/chat/conversation-operation-catalog'

const workspaceId = '11111111-1111-4111-8111-111111111111'

function Preview() {
  const panel = useChatPanel()
  const { resolvedTheme, setTheme } = useTheme()
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [showDraft, setShowDraft] = useState(false)
  const [showInterview, setShowInterview] = useState(false)
  return <>
    <div className="mb-4 flex flex-wrap gap-2">
      <Button onClick={() => panel.sendFromBar('이 사진으로 이번 주 홍보를 준비해줘')} variant="outline">전역 입력 인계 테스트</Button>
      <Button onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')} variant="outline">테마 전환</Button>
      <Button onClick={() => setSelected(value => !value)} variant="outline">선택 원고 맥락 예시</Button>
      <Button onClick={() => setReadOnly(value => !value)} variant="outline">읽기 전용 권한 예시</Button>
      <Button onClick={() => setShowDraft(value => !value)} variant="outline">저장 답안 예시</Button>
      <Button onClick={() => setShowInterview(value => !value)} variant="outline">질문 생략 제작 예시</Button>
    </div>
    {showInterview ? <ContentInterviewCard
      clarification={contentInterviewView(createInitialContentInterview({ originalPrompt: '신메뉴 인스타 게시물 만들어줘', channels: ['instagram'], requestedImageCounts: { instagram: 1 }, referenceMediaIds: [] }))}
      disabled={readOnly}
      onSubmit={submission => { setStatus(`검증용 제출: ${submission.displayMessage} · 실제 생성·게시·과금 없음`); return true }}
    /> : null}
    <ConversationShell
      messages={showDraft ? [{ id: '44444444-4444-4444-8444-444444444444', workspaceId, threadId: '55555555-5555-4555-8555-555555555555',
        role: 'sohee', status: 'completed', workItemId: null, createdAt: '2026-10-30T00:00:00Z', completedAt: '2026-10-30T00:00:01Z',
        content: '검증용 합성 답안이에요. 실제 고객 기록이나 발송 결과가 아닙니다.', interactionDrafts: [{
          id: '66666666-6666-4666-8666-666666666666', kind: 'interaction_draft', workspaceId,
          targetKind: 'comment', targetId: '77777777-7777-4777-8777-777777777777', draftId: '88888888-8888-4888-8888-888888888888',
          draftText: '안녕하세요. 상담 후 고객님께 맞는 내용을 자세히 안내드릴게요. 편하신 시간을 알려주세요.',
          fingerprint: 'a'.repeat(64), sourceRef: 'b'.repeat(64), channel: 'threads', customerLabel: '검증용 문의 고객',
          preparedAt: '2026-10-30T00:00:00Z', reused: false, requiresUserApproval: true,
        }] }] : []}
      connectionState="disconnected"
      composerDisabled={readOnly}
      disabledReason="검증용 읽기 전용 권한 예시예요."
      operationCatalog={buildConversationOperationCatalog({ workspaceId, role: readOnly ? 'viewer' : 'owner',
        workbenchEnabled: true, agentEnabled: true, modelConfigured: true, connectedChannels: [], observedAt: '2026-10-29T12:00:00Z' })}
      workContext={selected ? { workspaceId, contentId: '22222222-2222-4222-8222-222222222222', versionId: '33333333-3333-4333-8333-333333333333', versionNumber: 3,
        fingerprint: 'a'.repeat(64), title: '검증용 안내 원고', channel: 'threads', summary: '검증 예시입니다.', readOnly: true,
        returnHref: '/app/work/22222222-2222-4222-8222-222222222222' } : null}
      onSubmit={() => { setStatus('검증용 화면이므로 실제 요청은 전송하지 않았어요. 입력을 보존했어요.'); return false }}
      statusMessage={status}
      workspaceId={workspaceId}
    />
  </>
}

export function ConversationWorkbenchPreview() {
  return <ThemeProvider storageKey="sohee-workbench-preview-theme"><WorkspaceProvider value={{ workspaceId, workspaceName: '검증용 가게', workspaceKind: null,
    membershipRole: 'owner', actorId: '99999999-9999-4999-8999-999999999999', resolutionSource: 'membership' }}><ChatPanelProvider onOpenConversation={() => undefined} workspaceId={workspaceId}><Preview /></ChatPanelProvider></WorkspaceProvider></ThemeProvider>
}
