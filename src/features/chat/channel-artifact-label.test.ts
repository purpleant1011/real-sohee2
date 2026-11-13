import { describe, expect, it } from 'vitest'
import { conversationArtifactMessageArtifact } from './stream-events'
import type { ConversationArtifact } from './types'

function artifact(type: ConversationArtifact['type']): ConversationArtifact {
  return {
    id: 'artifact-1', workspaceId: 'workspace-1', sourceMessageId: 'message-1',
    type, status: 'partial', caption: '가게 소식', hashtags: [], cta: '', disclosure: '',
    observations: [], limitations: [], evidence: [], unresolvedQuestions: [],
    idempotencyKey: 'request-1', slides: [], contentItemId: 'content-1', versionId: 'version-3',
  }
}

describe('channel artifact labels', () => {
  it.each([
    ['instagram_post', '인스타그램 게시물 초안'],
    ['threads_post', '스레드 게시물 초안'],
    ['naver_blog_post', '네이버 블로그 원고 초안'],
  ] as const)('%s uses its own channel title without changing lineage', (type, title) => {
    const source = artifact(type)
    const view = conversationArtifactMessageArtifact(source)
    expect(view.title).toBe(title)
    expect(view.artifact).toBe(source)
    expect(view.id).toBe(source.id)
    expect(view.artifact.contentItemId).toBe('content-1')
    expect(view.artifact.versionId).toBe('version-3')
    expect(view.statusLabel).toBe('일부 완료')
  })
})
