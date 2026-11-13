'use client'

import { ConversationShell } from '@/features/chat/conversation-shell'
import type { ConversationArtifact } from '@/features/chat/types'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const artifact = {
  id: '77777777-7777-4777-8777-777777777777', workspaceId, sourceMessageId: '66666666-6666-4666-8666-666666666666',
  type: 'naver_blog_post', status: 'ready_for_review', caption: '', title: '상담 전 확인할 내용',
  naverBlog: {
    introduction: '방문 전 상담 항목을 확인해 주세요.',
    sections: [{ heading: '준비할 내용', body: '궁금한 점을 미리 정리해 주세요.' }],
    editorBlueprint: [
      { kind: 'paragraph', text: '방문 전 상담 항목을 확인해 주세요.' },
      { kind: 'heading', text: '준비할 내용' },
      { kind: 'paragraph', text: '궁금한 점을 미리 정리해 주세요.' },
    ],
    keywords: ['상담안내'], visibility: 'private',
  },
  hashtags: [], cta: '', disclosure: '', observations: [], limitations: ['후기·전후 사진은 사용하지 않았어요.'],
  evidence: ['검증용 합성 근거 (실제 가게 정보 아님)'], unresolvedQuestions: ['주차 가능 여부'], idempotencyKey: 'dev', slides: [],
} as unknown as ConversationArtifact

const message = {
  id: '66666666-6666-4666-8666-666666666666', workspaceId, threadId: '22222222-2222-4222-8222-222222222222',
  role: 'sohee' as const, content: '합성 시나리오입니다. 실제 생성·저장·게시는 하지 않아요.', status: 'completed' as const,
  workItemId: null, createdAt: '2026-08-10T01:00:00.000Z', completedAt: '2026-08-10T01:01:00.000Z',
}

export function BlogArtifactRailPreview() {
  return <ConversationShell
    connectionState="disconnected"
    messageDetails={{ [message.id]: { evidence: [], artifacts: [{
      id: artifact.id, kind: 'conversation_artifact', title: '인스타그램 게시물 초안', href: '/app/work',
      statusLabel: '검토 준비됨', requiresConfirmation: true, artifact,
    }] } }}
    messages={[message]}
  />
}
