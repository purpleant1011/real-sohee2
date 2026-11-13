import type { ConversationArtifact } from './types'
import { channelArtifactLabel } from './channel-artifact-label'
import type { ContentInterviewView } from './content-interview'
import type { CreditEstimateCardArtifact } from '@/features/credits/credit-estimate-card'
import type { PeriodPlanCardArtifact } from '@/features/plans/period-plan-card'

export type MessageEvidenceView = Readonly<{
  id: string
  kind: 'knowledge' | 'work' | 'schedule' | 'report' | 'customer_conversation' | 'policy'
  title: string
  href: string
}>

export type ProposalMessageArtifact = Readonly<{
  id: string
  kind: 'content_plan' | 'schedule_options' | 'harness_proposal'
  title: string
  href: string
  requiresConfirmation: true
}>

export type ImageMessageArtifact = Readonly<{
  id: string
  kind: 'image_draft'
  title: string
  href: string
  previewUrl: string
  statusLabel: '승인 대기' | '게시 승인 대기' | string
  requiresConfirmation: true
}>

export type ConversationArtifactMessageArtifact = Readonly<{
  id: string
  kind: 'conversation_artifact'
  title: string
  href: '/app/work'
  statusLabel: '검토 준비됨' | '일부 완료'
  requiresConfirmation: true
  artifact: ConversationArtifact
}>

export type PeriodPlanMessageArtifact = Readonly<PeriodPlanCardArtifact & { kind: 'period_plan'; requiresConfirmation: true }>
export type CreditEstimateMessageArtifact = Readonly<CreditEstimateCardArtifact & { kind: 'credit_estimate'; requiresConfirmation: true }>
export type SafeIntegrationArtifact = Readonly<{id:string;kind:'channel_preview'|'manual_assist'|'provider_readiness'|'automation_rule'|'performance_report'|'learning_candidate';title:string;href:string;statusLabel:'검토 준비됨'|'검토 후 자동 게시 준비'|'수동 마무리 필요'|'외부 확인 대기'|'승인 전 비활성';requiresConfirmation:true}>

export type RecoveryMessageArtifact = Readonly<{
  id: string;
  kind: 'booking_recovery';
  title: string;
  href: string;
  requiresConfirmation: true;
  caseId: string;
  missionId: string;
  version: number;
  view: import('@/features/booking-recovery/contracts').RecoveryView;
}>;

export type TaskTimelineStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'unknown' | 'awaiting_approval'

export type TaskTimelineItem = Readonly<{
  id: string
  title: string
  status: TaskTimelineStepStatus
  durationMs?: number
  capabilityId?: 'comment.reply_draft' | 'dm.reply_draft'
}>

export type TaskTimelineMessageArtifact = Readonly<{
  id: string
  kind: 'task_timeline'
  title: string
  totalSteps: number
  completedSteps: number
  steps: readonly TaskTimelineItem[]
  isLive?: boolean
}>

export function conversationArtifactMessageArtifact(
  artifact: ConversationArtifact,
): ConversationArtifactMessageArtifact {
  return Object.freeze({
    id: artifact.id,
    kind: 'conversation_artifact',
    title: channelArtifactLabel(artifact.type).draft,
    href: '/app/work',
    statusLabel: artifact.status === 'partial' ? '일부 완료' : '검토 준비됨',
    requiresConfirmation: true,
    artifact,
  })
}

export type MessageArtifact =
  | ProposalMessageArtifact
  | ImageMessageArtifact
  | ConversationArtifactMessageArtifact
  | PeriodPlanMessageArtifact
  | CreditEstimateMessageArtifact
  | SafeIntegrationArtifact
  | RecoveryMessageArtifact
  | TaskTimelineMessageArtifact

export type ChatStreamEvent =
  | { type: 'message.started'; messageId: string }
  | { type: 'message.pending'; messageId: string; message: string }
  | { type: 'message.delta'; messageId: string; delta: string }
  | { type: 'message.clarification'; messageId: string; clarification: ContentInterviewView }
  | { type: 'message.evidence'; messageId: string; evidence: MessageEvidenceView }
  | { type: 'message.artifact'; messageId: string; artifact: MessageArtifact }
  | { type: 'recovery.updated'; messageId: string; caseId: string; missionId: string; version: number; view: import('@/features/booking-recovery/contracts').RecoveryView }
  | { type: 'task_progress'; messageId: string; timeline: TaskTimelineMessageArtifact }
  | { type: 'message.completed'; messageId: string }
  | { type: 'message.failed'; messageId: string; code: string; message: string }
  | { type: 'artifact_created'; messageId: string; artifactId: string; requestedCount: number }
  | { type: 'slide_progress'; messageId: string; slideId: string; position: number; status: string }
  | { type: 'artifact_ready'; messageId: string; artifact: ConversationArtifact }
  | { type: 'artifact_partial'; messageId: string; artifact: ConversationArtifact }
