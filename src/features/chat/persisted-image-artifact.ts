import type { ImageMessageArtifact } from './stream-events'
import type { ConversationMessage } from './types'

export function persistedImageArtifact(
  message: Pick<ConversationMessage, 'artifact' | 'workspaceId'>,
): ImageMessageArtifact | null {
  if (message.artifact?.type !== 'media_asset') return null

  const href = `/api/workspaces/${message.workspaceId}/media/${message.artifact.id}`
  return Object.freeze({
    id: message.artifact.id,
    kind: 'image_draft',
    title: 'AI 생성 이미지 초안',
    href,
    previewUrl: href,
    statusLabel: '게시 승인 대기',
    requiresConfirmation: true,
  })
}
