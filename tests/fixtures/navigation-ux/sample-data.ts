import type { ConnectorHubSnapshot } from '@/features/marketing-connectors/catalog'
import type { WorkspaceContextValue } from '@/components/workspace/workspace-provider'
import type { ConversationThreadSummary } from '@/features/chat/thread-repository'

export const SAMPLE_WORKSPACE: WorkspaceContextValue = {
  workspaceId: '11111111-2222-4333-8444-555555555555',
  workspaceName: '소희 베이커리 (성수본점)',
  workspaceKind: 'retail',
  membershipRole: 'owner',
  actorId: 'usr-fixture-owner-001',
  resolutionSource: 'explicit-selection',
  workspaceCanSwitch: true,
  conversationWorkbenchEnabled: true,
}

export const SAMPLE_CONNECTOR_SNAPSHOT: ConnectorHubSnapshot = {
  workspaceId: SAMPLE_WORKSPACE.workspaceId,
  connections: [
    {
      connectorId: 'instagram',
      status: 'connected',
      lastSyncAt: '2026-11-11T09:30:00.000Z',
      capabilities: ['posts', 'stories', 'insights'],
    },
    {
      connectorId: 'threads',
      status: 'connected',
      lastSyncAt: '2026-11-11T10:15:00.000Z',
      capabilities: ['posts', 'replies'],
    },
    {
      connectorId: 'google_calendar',
      status: 'disconnected',
      lastSyncAt: null,
      capabilities: ['events'],
    },
  ],
  storageReady: true,
  pendingDeletions: [],
}

/** Task5 모바일 과거대화 고정헤더+목록스크롤 검증용 합성 20개 대화 스레드 */
export const SAMPLE_CONVERSATION_THREADS: readonly ConversationThreadSummary[] = Array.from({ length: 20 }, (_, idx) => {
  const num = idx + 1
  const padded = String(num).padStart(2, '0')
  const dateNum = 20 - idx
  const dayStr = String(Math.max(1, dateNum)).padStart(2, '0')
  return {
    id: `thread-fixture-uuid-${padded}`,
    workspaceId: SAMPLE_WORKSPACE.workspaceId,
    title: num === 1
      ? '가을 시즌 신메뉴 인스타 피드 초안 작성'
      : num === 2
      ? '빼빼로데이 사전예약 네이버 플레이스 공지'
      : num === 3
      ? '당근마켓 단골 맺기 이벤트 쿠폰 발행'
      : `마케팅 업무 대화 기록 #${num} - 매장 프로모션 진행`,
    status: num === 5 || num === 12 ? 'archived' : 'active',
    lastMessageAt: `2026-11-${dayStr}T14:30:00.000Z`,
    createdAt: `2026-11-${dayStr}T10:00:00.000Z`,
    updatedAt: `2026-11-${dayStr}T14:30:00.000Z`,
  }
})

