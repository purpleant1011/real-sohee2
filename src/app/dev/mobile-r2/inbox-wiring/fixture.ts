import type { InboxViewSnapshot } from '@/features/mobile-inbox/inbox-view'

/** 하네스가 쓰는 가짜 가게 id. `ws-default` 금지 규칙을 피하려고 이름을 분리했다. */
export const PREVIEW_WORKSPACE_ID = 'preview-workspace'

/**
 * 서버 목록 read-model(`readMobileInbox`)이 내려주는 모양을 그대로 흉내 낸 고정 스냅샷.
 * 실제 DB 조회 결과가 아니며, 화면 배치·상태를 육안 검수하기 위한 예시입니다.
 */
export const INBOX_PREVIEW_SNAPSHOT: InboxViewSnapshot = {
  loadState: 'ready',
  workspaceId: PREVIEW_WORKSPACE_ID,
  complete: true,
  checkedAt: '2026-10-24T00:00:00.000Z',
  threads: [
    {
      id: 'preview-thread-1',
      workspaceId: PREVIEW_WORKSPACE_ID,
      channel: 'instagram_dm',
      customerName: '김예시',
      consent: 'granted',
      status: 'draft_ready',
      unread: true,
      lastMessage: {
        text: '목요일 오후에 속눈썹펌 예약 가능한 시간 있을까요?',
        receivedAt: '2026-10-23T08:50:00.000Z',
        fromCustomer: true,
      },
      draft: { text: '목요일 오후 2시와 4시 30분에 가능해요.', sources: ['예약표', '시술 안내'] },
      sendBlockers: [],
    },
    {
      id: 'preview-thread-2',
      workspaceId: PREVIEW_WORKSPACE_ID,
      channel: 'kakao',
      customerName: '이예시',
      consent: 'unknown',
      status: 'needs_reply',
      unread: false,
      lastMessage: {
        text: '가격이 어떻게 되나요?',
        receivedAt: '2026-10-23T07:10:00.000Z',
        fromCustomer: true,
      },
      draft: null,
      // 동의 근거가 없으면 답안을 보내지 않는다. 막힌 이유를 화면에 남긴다.
      sendBlockers: ['CONSENT_MISSING'],
    },
    {
      id: 'preview-thread-3',
      workspaceId: PREVIEW_WORKSPACE_ID,
      channel: 'instagram_comment',
      customerName: '박예시',
      consent: 'granted',
      status: 'waiting_customer',
      unread: false,
      lastMessage: {
        text: '네, 예약금 입금했어요.',
        receivedAt: '2026-10-22T05:30:00.000Z',
        fromCustomer: false,
      },
      draft: null,
      sendBlockers: [],
    },
  ],
}
