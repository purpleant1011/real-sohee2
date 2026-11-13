import type { VaultChannel } from '../types'

export interface VaultBundleImage {
  id: string
  position: number
  storageBucket: string
  objectPath: string
  format: string
  width: number
  height: number
  signedUrl: string
  downloadFilename: string
}

export interface VaultCopyBundlePublicationStatus {
  statusLabel: string
  isPublishedUrlRegistered: boolean
  publishedUrl: string | null
  registeredAt: string | null
}

export interface VaultCopyBundle {
  itemRef: string
  channel: VaultChannel
  channelLabel: string
  title: string | null
  body: string
  tags: string[]
  formattedTags: string
  fullText: string
  settingsNotice: string
  images: VaultBundleImage[]
  guideSteps: string[]
  publicationStatus: VaultCopyBundlePublicationStatus
}

export interface ManualPublishRecord {
  id: string
  workspaceId: string
  vaultItemId: string
  channel: VaultChannel
  publishedUrl: string
  verificationStatus: 'UNVERIFIED'
  registeredBy: string | null
  createdAt: string
  updatedAt: string
}

export interface RegisterPublishUrlInput {
  workspaceId: string
  itemRef: string
  actorId: string
  /** 서비스 계층 이중 검사용. 라우트는 반드시 전달하며, 값이 있으면 대표/관리자만 허용한다. 생략은 서버 내부 호출 전용. */
  actorRole?: string
  url: string
}

export interface RegisterPublishUrlResult {
  success: boolean
  publishedUrl: string
  statusLabel: string
  registeredAt: string
}
