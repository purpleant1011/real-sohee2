import { ConversationDetailEntry } from './conversation-detail-entry'

/**
 * M13 대화 상세(`/app/engagement/:id`) — 셸 라우트 맵이 제안하던 경로를 실제 페이지로 만든다.
 * 상세 키는 소통함 목록이 쓰는 `dm:<uuid>` / `comment:<uuid>` 이고, 조회는 기존 읽기 API 만 쓴다.
 */
export default async function EngagementThreadRoute({
  params,
}: Readonly<{ params: Promise<{ threadKey: string }> }>) {
  const { threadKey } = await params
  return <ConversationDetailEntry threadKey={threadKey} />
}
