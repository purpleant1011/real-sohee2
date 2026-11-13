import 'server-only'

import type { ApprovedExternalAction, ExternalActionChannel, OrderedExternalMedia } from './types'

export type ManualAssistPackage = Readonly<{
  contentVersionId: string
  approvalFingerprint: string
  targetExternalId: string
  targetLabel: string
  destinationUrl: string
  text: string
  media: readonly OrderedExternalMedia[]
  resultRecordingPath: string
}>

const destinationByChannel: Record<ExternalActionChannel, string> = {
  instagram: 'https://www.instagram.com/',
  threads: 'https://www.threads.com/',
  naver_blog: 'https://blog.naver.com/',
  naver_place: 'https://smartplace.naver.com/',
  daangn_business: 'https://business.daangn.com/',
} as const

function assertSequentialMedia(media: readonly OrderedExternalMedia[]): void {
  if (media.length === 0 || media.some((item, index) => item.position !== index)) {
    throw new Error('승인된 미디어 순서를 확인할 수 없습니다.')
  }
}

export function buildManualAssistPackage(action: ApprovedExternalAction): ManualAssistPackage {
  assertSequentialMedia(action.contentVersion.media)

  return Object.freeze({
    contentVersionId: action.contentVersion.id,
    approvalFingerprint: action.approval.fingerprint,
    targetExternalId: action.target.externalId,
    targetLabel: action.target.label,
    destinationUrl: destinationByChannel[action.channel],
    text: action.contentVersion.text,
    media: Object.freeze(action.contentVersion.media.map((item) => Object.freeze({ ...item }))),
    resultRecordingPath: `/app/external-actions/result?contentVersionId=${encodeURIComponent(action.contentVersion.id)}&approvalFingerprint=${encodeURIComponent(action.approval.fingerprint)}`,
  })
}
