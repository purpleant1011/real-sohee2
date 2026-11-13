import type { SupportedChannel } from '@/features/channels/channel-capabilities'
import type { NaverVisibility } from '@/features/naver-publish/types'
import type { ChannelContent } from './channel-content-schema'

export type ContentStatus =
  | 'draft'
  | 'review'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'archived'

export type ContentChannel = SupportedChannel

export type WorkFilter = 'all' | 'in_progress' | 'recovery' | 'approved'

export type ContentVersionMedia = Readonly<{
  id: string
  position: number
  mimeType: string
  altText: string
  role: 'cover' | 'detail' | 'proof' | 'action' | null
  rightsStatus: 'pending' | 'confirmed' | 'rejected'
  /**
   * 원본 사진 기준 가로·세로(px)와 용량(byte). 업로드 시점에 기록된 값이다.
   * 서버가 모르면 null 이며, 0 은 '모름'을 뜻하는 값이 아니므로 쓰지 않는다.
   */
  width?: number | null
  height?: number | null
  sizeBytes?: number | null
}>

export type ContentVersionSummary = Readonly<{
  id: string
  versionNumber: number
  caption: string
  hashtags: readonly string[]
  disclosure: string
  fingerprint: string
  revisionReason: string | null
  createdAt: string
  rightsConfirmed: boolean
  generationEvidenceConfirmed: boolean
  mediaCount: number
  media: readonly ContentVersionMedia[]
  structuredPayload: ChannelContent | null
  knowledgeIds: readonly string[]
  harnessRuleIds: readonly string[]
}>

export type ContentListItem = Readonly<{
  id: string
  title: string
  status: ContentStatus
  channel: ContentChannel
  currentVersionId: string | null
  currentVersionNumber: number | null
  currentCaption: string | null
  updatedAt: string
  source: 'actual'
  needsRecovery: boolean
}>

export type ContentListResult = Readonly<{
  items: readonly ContentListItem[]
  nextCursor: string | null
}>

export type ContentDetail = Readonly<{
  id: string
  title: string
  status: ContentStatus
  channel: ContentChannel
  currentVersionId: string | null
  currentVersionNumber: number | null
  createdAt: string
  updatedAt: string
  source: 'actual'
  versions: readonly ContentVersionSummary[]
}>

export type ContentMediaAsset = Readonly<{
  id: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}>

export type ApprovalPreviewIssue = Readonly<{
  code: string
  message: string
  recoveryHref?: string
}>

export type ApprovalPreviewSnapshot = Readonly<{
  workspaceId: string
  contentId: string
  versionId: string
  versionNumber: number
  fingerprint: string
  approval: Readonly<{
    id: string | null
    status: 'unreviewed' | 'approved' | 'rejected'
    fingerprint: string | null
  }>
  channel: 'instagram' | 'threads' | 'naver_blog'
  visibility?: NaverVisibility | null
  account: Readonly<{
    connectionId: string | null
    label: string
    status: 'disconnected' | 'connecting' | 'connected' | 'expired' | 'missing_permission' | 'wrong_account' | 'provider_error' | 'error'
  }>
  caption: string
  hashtags: readonly string[]
  disclosure: string
  text: string
  naverCopy?: Readonly<Pick<Extract<ChannelContent, { channel: 'naver_blog' }>,
    'title' | 'introduction' | 'sections' | 'keywords' | 'cta'>>
  naverRevisionReadiness?: 'ready' | 'not_ready' | 'unavailable'
  naverBlocks?: readonly (
    | Readonly<{ kind: 'paragraph' | 'heading' | 'quote' | 'cta'; text: string }>
    | Readonly<{ kind: 'image'; mediaId: string; altText: string }>
    | Readonly<{ kind: 'link'; url: string; title: string }>
    | Readonly<{ kind: 'map'; placeName: string }>
  )[]
  media: readonly Readonly<{
    id: string
    position: number
    mimeType: string
    altText: string
    src: string
    /** 서버가 아는 원본 크기·용량. 모르면 null 이고 화면은 브라우저 실측으로 넘어간다. */
    width?: number | null
    height?: number | null
    sizeBytes?: number | null
  }>[]
  issues: readonly ApprovalPreviewIssue[]
}>
