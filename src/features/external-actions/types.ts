export type ExternalActionKind =
  | 'profile_edit'
  | 'news_post'
  | 'blog_post'
  | 'business_news_post'
  | 'feed_publish'
  | 'thread_publish'
  | 'comment_reply'
  | 'story_publish'
  | 'dm_reply'

export type ExternalActionStatus =
  | 'connection_required'
  | 'user_login_required'
  | 'ready'
  | 'prepared'
  | 'approval_required'
  | 'executing'
  | 'submitted'
  | 'provider_review'
  | 'succeeded'
  | 'failed'
  | 'manual_assist_required'
  | 'unknown_result'
  | 'reconfirmation_required'

export type ExternalFailureCode =
  | 'REAUTH_REQUIRED'
  | 'CATEGORY_NOT_FOUND'
  | 'DRAFT_RECOVERY_PENDING'
  | 'UI_DRIFT'
  | 'TARGET_MISMATCH'
  | 'POLICY_RESTRICTION'
  | 'DOCUMENT_REQUIRED'
  | 'DUPLICATE_AMBIGUOUS'
  | 'UNKNOWN_RESULT'
  | 'BROKER_UNAVAILABLE'
  | 'CONTENT_MISMATCH'
  | 'MEDIA_DOWNLOAD_FAILED'
  | 'MEDIA_UPLOAD_FAILED'
  | 'DEADLINE_EXPIRED'
  | 'DEVICE_OFFLINE'
  | 'SUBMIT_PERMIT_REQUIRED'

export type ExternalActionChannel =
  | 'instagram'
  | 'threads'
  | 'naver_blog'
  | 'naver_place'
  | 'daangn_business'

export type OrderedExternalMedia = Readonly<{
  id: string
  position: number
  signedUrl: string
}>

export type ExactApprovedContentVersion = Readonly<{
  id: string
  fingerprint: string
  text: string
  media: readonly OrderedExternalMedia[]
}>

export type ExternalActionTarget = Readonly<{
  externalId: string
  label: string
}>

export type ApprovedExternalAction = Readonly<{
  workspaceId: string
  channel: ExternalActionChannel
  actionKind: ExternalActionKind
  target: ExternalActionTarget
  contentVersion: ExactApprovedContentVersion
  approval: Readonly<{ id: string; fingerprint: string }>
}>

export type BrokerFailure = Readonly<{
  ok: false
  code: ExternalFailureCode
  status: 'manual_assist_required' | 'failed' | 'unknown_result'
}>

export type ExternalExecutionResult = BrokerFailure | Readonly<{
  ok: true
  status: Extract<ExternalActionStatus, 'submitted' | 'provider_review' | 'succeeded'>
  providerReference: string
}>
