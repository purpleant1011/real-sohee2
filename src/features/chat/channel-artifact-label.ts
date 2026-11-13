import type { ConversationArtifact } from './types'

const labels = {
  instagram_post: { channel: 'Instagram', draft: '인스타그램 게시물 초안' },
  threads_post: { channel: 'Threads', draft: '스레드 게시물 초안' },
  naver_blog_post: { channel: '네이버 블로그', draft: '네이버 블로그 원고 초안' },
} as const

export function channelArtifactLabel(type: ConversationArtifact['type']) {
  return labels[type]
}
