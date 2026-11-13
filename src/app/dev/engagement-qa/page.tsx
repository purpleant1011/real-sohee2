import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { EngagementInbox } from '@/features/engagement/engagement-inbox'
import type { EngagementCommentsResponse } from '@/features/engagement/types'

export const dynamic = 'force-dynamic'

const SYNTHETIC_DATA: EngagementCommentsResponse = {
  items: [
    {
      id: 'synth-comment-1',
      workspace_id: '00000000-0000-0000-0000-000000000000',
      channel_connection_id: 'synth-conn-ig',
      channel: 'instagram',
      channel_label: '인스타그램',
      account_label: '@sohee_cafe',
      provider_comment_id: 'synth-p-1',
      provider_media_id: 'synth-m-1',
      author_handle: 'spring_breeze',
      author_id: 'synth-u-1',
      comment_text: '오늘 처음 가봤는데 라떼가 정말 고소하고 분위기도 따뜻했어요! 다음엔 디저트도 먹어보러 갈게요 :)',
      comment_created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      classification: 'THANKS',
      classification_label: '감사',
      confidence: 0.98,
      status: 'DRAFTED',
      status_label: '초안 준비됨',
      failure_reason: null,
      created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      updated_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      draft: {
        id: 'synth-draft-1',
        workspace_id: '00000000-0000-0000-0000-000000000000',
        comment_id: 'synth-comment-1',
        draft_text: '첫 방문에 라떼와 분위기 모두 마음에 드셨다니 정말 기뻐요! 다음엔 인기 디저트도 꼭 맛보세요. 늘 반갑게 맞이할게요 ☕',
        approved_fingerprint: null,
        approved_by: null,
        approved_at: null,
        is_auto_approved: false,
        created_at: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
        updated_at: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
      },
    },
    {
      id: 'synth-comment-2',
      workspace_id: '00000000-0000-0000-0000-000000000000',
      channel_connection_id: 'synth-conn-th',
      channel: 'threads',
      channel_label: '스레드',
      account_label: '@sohee_cafe',
      provider_comment_id: 'synth-p-2',
      provider_media_id: 'synth-m-2',
      author_handle: 'urban_walker',
      author_id: 'synth-u-2',
      comment_text: '반려견 동반도 가능한 매장인가요? 주말 방문 희망합니다.',
      comment_created_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
      classification: 'QUESTION',
      classification_label: '질문',
      confidence: 0.92,
      status: 'APPROVED',
      status_label: '승인됨',
      failure_reason: null,
      created_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
      updated_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
      draft: {
        id: 'synth-draft-2',
        workspace_id: '00000000-0000-0000-0000-000000000000',
        comment_id: 'synth-comment-2',
        draft_text: '네! 실내 케이지 또는 리드줄 착용 시 테라스 좌석에서 반려동물 동반이 가능합니다. 주말에 뵙겠습니다.',
        approved_fingerprint: 'synth-fp-2',
        approved_by: 'dev-user',
        approved_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
        is_auto_approved: false,
        created_at: new Date(Date.now() - 1000 * 60 * 85).toISOString(),
        updated_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      },
    },
  ],
  send_enabled: false,
  cycle_enabled: false,
  auto_replied_today_count: 0,
}

export default function EngagementQaDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-muted-foreground">소통함 QA 하네스 로딩 중...</div>}>
      <div className="min-h-screen bg-background">
        <aside
          role="note"
          className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-b border-amber-500/20 px-4 py-2 text-center text-xs font-semibold"
        >
          예시 데이터 · 실제 고객 전송 없음 (개발 QA 테스트 하네스)
        </aside>
        <EngagementInbox
          workspaceId="00000000-0000-0000-0000-000000000000"
          initialData={SYNTHETIC_DATA}
        />
      </div>
    </Suspense>
  )
}
