import type { CommentClassification, CommentStatus, SocialChannel } from './types'

export const CHANNEL_LABELS: Readonly<Record<SocialChannel, string>> = Object.freeze({
  instagram: '인스타그램',
  threads: '스레드',
})

export const STATUS_LABELS: Readonly<Record<CommentStatus, string>> = Object.freeze({
  RECEIVED: '새 댓글',
  CLASSIFIED: '분석됨',
  DRAFTED: '초안 준비됨',
  APPROVED: '승인됨',
  SENDING: '보내는 중',
  SENT: '답글 완료',
  DISMISSED: '무시함',
  NEEDS_CHECK: '확인 필요',
  FAILED: '보내지 못했어요',
})

export const CLASSIFICATION_LABELS: Readonly<Record<CommentClassification, string>> = Object.freeze({
  THANKS: '감사',
  GREETING: '인사',
  QUESTION: '질문',
  COMPLAINT: '불만',
  SENSITIVE: '민감한 내용',
  SPAM: '스팸',
  NEEDS_HUMAN: '직접 확인 필요',
})

export function getChannelLabel(channel: SocialChannel): string {
  return CHANNEL_LABELS[channel] ?? channel
}

export function getStatusLabel(status: CommentStatus): string {
  return STATUS_LABELS[status] ?? status
}

export function getClassificationLabel(classification: CommentClassification | null | undefined): string | null {
  if (!classification) return null
  return CLASSIFICATION_LABELS[classification] ?? classification
}
