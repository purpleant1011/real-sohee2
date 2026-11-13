import { notFound } from 'next/navigation'
import { ConversationClient } from '@/features/chat/conversation-client'

export const dynamic = 'force-dynamic'

export default function BlogStrategyDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <main>
    <h1 className="px-4 py-3 text-lg font-semibold">대화·블로그 전략 검증 · 테스트 전용</h1>
    <a href="/dev/blog-strategy/review" className="mx-4 inline-flex min-h-11 items-center text-sm underline">로그인 없이 성장 브리핑 예시 살펴보기</a>
    <ConversationClient backgroundJobs initialMessages={[]}
      workspaceId="11111111-1111-4111-8111-111111111111"
      threadId="22222222-2222-4222-8222-222222222222" />
  </main>
}
