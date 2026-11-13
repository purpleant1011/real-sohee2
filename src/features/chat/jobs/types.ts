import type { UsageEventInput } from '@/features/credits/usage-event'

export type ConversationJobStatus =
  | 'queued'
  | 'running'
  | 'cancel_requested'
  | 'succeeded'
  | 'needs_attention'
  | 'cancelled'

export type ConversationJob = Readonly<{
  id: string
  workspaceId: string
  threadId: string
  userMessageId: string
  assistantMessageId: string
  reservationId: string
  status: ConversationJobStatus
  kind: 'chat' | 'content_generation' | 'image_generation' | 'publish_preparation'
  sequenceNumber: number
  workerId: string | null
}>

export type ClaimConversationJobResult =
  | Readonly<{ state: 'claimed'; job: ConversationJob }>
  | Readonly<{ state: 'terminal'; job: ConversationJob }>
  | Readonly<{ state: 'blocked_by_predecessor' }>
  | Readonly<{ state: 'missing' }>
  | Readonly<{ state: 'not_claimed' }>

export type RecordedJobUsage = Readonly<{
  providerCallKey: string
  event: UsageEventInput
}>

export type ConversationJobExecution = Readonly<{
  status: 'succeeded' | 'needs_attention' | 'cancelled'
  safeErrorCode: string | null
  billingDisposition: 'settle_usage' | 'release'
  usage: readonly RecordedJobUsage[]
}>

export type ConversationJobDependencies = Readonly<{
  repository: Readonly<{
    claim(jobId: string, workerId: string): Promise<ClaimConversationJobResult>
    recordUsage(job: ConversationJob, usage: RecordedJobUsage, credits: number): Promise<void>
    complete(
      job: ConversationJob,
      status: 'succeeded' | 'needs_attention' | 'cancelled',
      safeErrorCode: string | null,
    ): Promise<void>
  }>
  executor: Readonly<{
    execute(job: ConversationJob): Promise<ConversationJobExecution>
  }>
  credits: Readonly<{
    settle(job: ConversationJob, actualCredits: number): Promise<void>
    release(job: ConversationJob, reason: string): Promise<void>
  }>
}>
