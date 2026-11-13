'use client'

import { useState } from 'react'
import { LiveRegion } from '@/components/mobile-ui'
import { MobileInboxView, type InboxViewSnapshot } from './inbox-view'

/**
 * M13 소통함 화면의 예시 마운트(프로토타입용).
 *
 * 셸 없이 본문만 내보내므로 `/dev/mobile-r2` 레지스트리와 인터랙티브 셸이 같은 화면을
 * 그대로 가져다 쓸 수 있다. 조회·전송·복사 요청은 하지 않는다(fetch 없음).
 * 답안 검토·복사 버튼은 저장이나 전송으로 이어지지 않고, 그 사실만 알린다.
 */
export function ExampleInboxScreen() {
  const [notice, setNotice] = useState('')

  return (
    <div data-example-inbox-screen className="space-y-4">
      <p
        data-example-notice
        className="rounded-xl bg-muted/40 px-3 py-2 text-sm leading-relaxed text-muted-foreground"
      >
        예시 화면이에요. 실제로 받은 문의가 아니라 화면 모양을 보여드리는 내용이고, 답장은 실제로 보내지 않아요.
      </p>
      {notice ? (
        <LiveRegion
          message={notice}
          visible
          className="rounded-xl bg-state-quiet-soft px-3 py-2 text-sm text-state-quiet"
        />
      ) : null}
      <MobileInboxView
        snapshot={EXAMPLE_SNAPSHOT}
        onOpenThread={() => setNotice('예시 화면이라 대화 상세로 넘어가지 않아요. 실제 대화는 앱에서 확인해 주세요.')}
        onCopyDraft={() => setNotice('예시 화면이라 답안을 복사하지 않아요. 실제 답장은 앱에서 해 주세요.')}
      />
    </div>
  )
}

const OBSERVED_AT = '2026-10-23T09:00:00.000Z'

/** 예시 문의. 답안 검토로 갈 수 있는 건과 막혀서 복사만 되는 건을 함께 둔다. */
const EXAMPLE_SNAPSHOT: InboxViewSnapshot = {
  loadState: 'ready',
  workspaceId: 'preview-workspace',
  complete: true,
  checkedAt: OBSERVED_AT,
  threads: [
    {
      id: 'preview-thread-1',
      workspaceId: 'preview-workspace',
      channel: 'instagram_dm',
      customerName: '김예시',
      consent: 'granted',
      status: 'draft_ready',
      unread: true,
      lastMessage: {
        text: '목요일 오후에 속눈썹펌 예약 가능한 시간 있을까요?',
        receivedAt: '2026-10-22T05:10:00.000Z',
        fromCustomer: true,
      },
      draft: { text: '목요일 오후 2시와 4시 30분에 가능해요.', sources: ['예약표', '시술 안내'] },
      sendBlockers: [],
    },
    {
      id: 'preview-thread-2',
      workspaceId: 'preview-workspace',
      channel: 'kakao',
      customerName: '이예시',
      consent: 'unknown',
      status: 'needs_reply',
      unread: false,
      lastMessage: {
        text: '가격이 어떻게 되나요?',
        receivedAt: '2026-10-22T03:00:00.000Z',
        fromCustomer: true,
      },
      draft: { text: '시술별 가격 안내드릴게요.', sources: [] },
      sendBlockers: ['NO_SEND_SCOPE'],
    },
  ],
}
