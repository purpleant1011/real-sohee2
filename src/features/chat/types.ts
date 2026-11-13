import type { ContentInterviewView } from './content-interview'

export type ChatResourceKind =
  | 'content'
  | 'schedule'
  | 'notification'
  | 'knowledge'
  | 'automation'

export type ChatSelectedResource = Readonly<{
  kind: ChatResourceKind
  id: string
  title: string
  statusLabel: string
  summary?: string
}>

export type ChatContext = Readonly<{
  route: string
  selectedResource: ChatSelectedResource | null
}>

export type ChatAction = Readonly<{
  label: string
  href: string
  requiresConfirmation: true
}>

export type ConversationMessage = Readonly<{
  id: string
  clientMessageId?: string
  workspaceId: string
  threadId: string
  role: 'user' | 'sohee' | 'system_event'
  content: string
  status: 'queued' | 'streaming' | 'completed' | 'failed' | 'cancelled'
  workItemId: string | null
  createdAt: string
  completedAt: string | null
  taskTimeline?: import('./stream-events').TaskTimelineMessageArtifact
  interactionDrafts?: readonly import('@/features/engagement/interaction-draft-contract').InteractionDraftCardData[]
  interactionDraftsUnavailable?: boolean
  clarification?: ContentInterviewView
  artifact?: Readonly<{
    type: 'media_asset'
    id: string
  }>
  artifacts?: readonly ConversationArtifactReference[]
}>

export type ConversationArtifactReference = Readonly<{
  type: 'conversation_artifact'
  id: string
}>

export type ConversationArtifactSlide = Readonly<{
  id: string
  position: number
  role: 'cover' | 'detail' | 'proof' | 'action'
  status: 'succeeded' | 'failed' | 'cancelled'
  mediaAssetId: string | null
  altText: string
  retryable: boolean
  safeErrorCode:
    | 'IMAGE_PROVIDER_UNAVAILABLE'
    | 'IMAGE_POLICY_REJECTED'
    | 'IMAGE_RETRYABLE'
    | 'IMAGE_AUTH_REQUIRED'
    | 'IMAGE_QUOTA_EXHAUSTED'
    | 'IMAGE_RATE_LIMITED'
    | 'IMAGE_MODEL_UNAVAILABLE'
    | 'IMAGE_PROMPT_INVALID'
    | null
}>

export type ConversationNaverEditorBlueprintBlock =
  | Readonly<{ kind: 'paragraph' | 'heading' | 'quote' | 'cta'; text: string }>
  | Readonly<{ kind: 'image_slot'; position: number; altText: string }>
  | Readonly<{ kind: 'link'; url: string; title: string }>
  | Readonly<{ kind: 'map'; placeName: string }>

export type ConversationArtifact = Readonly<{
  id: string
  workspaceId: string
  sourceMessageId: string
  type: 'instagram_post' | 'threads_post' | 'naver_blog_post'
  status: 'preparing' | 'partial' | 'ready_for_review' | 'failed' | 'archived'
  caption: string
  title?: string | null
  naverBlog?: Readonly<{
    introduction: string
    sections: readonly Readonly<{ heading: string; body: string }>[]
    editorBlueprint?: readonly ConversationNaverEditorBlueprintBlock[]
    keywords: readonly string[]
    visibility: 'private' | 'public'
    factBasis?: import('@/features/content/approved-fact-basis').ApprovedFactBasis
    strategyBrief?: import('@/features/content/blog-strategy-brief').BlogStrategyBrief
    generation?: Readonly<{
      mode: 'api_only'
      text: 'openai_responses_api'
      images: 'openai_images_api'
    }>
  }> | null
  hashtags: readonly string[]
  cta: string
  disclosure: string
  observations: readonly string[]
  limitations: readonly string[]
  evidence: readonly string[]
  unresolvedQuestions: readonly string[]
  idempotencyKey: string
  workItemId?: string | null
  contentItemId?: string | null
  versionId?: string | null
  needs_facts?: boolean
  slides: readonly ConversationArtifactSlide[]
}>
