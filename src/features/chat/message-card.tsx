'use client'

import { AppLink as Link } from '@/components/navigation/app-link'
import Image from 'next/image'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import type { ChatAction, ConversationMessage } from './types'
import type { MessageArtifact, MessageEvidenceView } from './stream-events'
import { ContentInterviewCard } from './content-interview-card'
import type { ComposerSubmit } from './conversation-composer'
import { SocialProposalSet } from './social-proposal-set'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { ResearchPlanCard } from './research-plan-card'
import { periodPlanToResearchPlan } from './period-plan-adapter'
import { PeriodPlanCard, type PeriodPlanAction } from '@/features/plans/period-plan-card'
import { CreditEstimateCard } from '@/features/credits/credit-estimate-card'
import { IntegrationArtifactRenderer } from './integration-artifact-renderer'
import { RecoveryCard } from '@/features/booking-recovery/components/recovery-card'
import { ConversationTaskTimeline } from './conversation-task-timeline'
import { ConversationInteractionDraftCard } from './conversation-interaction-draft-card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard'
import styles from './conversation-shell.module.css'
import { SoheeAvatar } from '@/components/brand/sohee-avatar'
import { UserAvatar } from '@/features/account/user-avatar'
function isIntegrationArtifact(artifact: MessageArtifact): artifact is Extract<MessageArtifact,{kind:'channel_preview'|'manual_assist'|'provider_readiness'|'automation_rule'|'performance_report'|'learning_candidate'}>{return ['channel_preview','manual_assist','provider_readiness','automation_rule','performance_report','learning_candidate'].includes(artifact.kind)}

const messageLabels = {
  sohee: '소희 메시지',
  user: '내 메시지',
  system_event: '운영 알림',
} as const

const internalIdentifierPattern = /`?[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}`?/giu

type MessageCardProps = Readonly<{
  attachmentIds?: readonly string[]
  actions?: readonly ChatAction[]
  artifacts?: readonly MessageArtifact[]
  evidence?: readonly MessageEvidenceView[]
  message: ConversationMessage
  onPeriodPlanAction?: (action: PeriodPlanAction) => void
  onSubmit?: (submission: ComposerSubmit) => void | boolean | Promise<void | boolean>
  onRetry?: (messageId: string) => void
  onRetrySlides?: (replyToMessageId: string, artifactId: string, selectedSlideIds: readonly string[]) => void | Promise<void>
  planActionsDisabled?: boolean
  workspaceId?: string
}>

function messageTime(timestamp: string) {
  const epoch = new Date(timestamp).getTime()
  if (!Number.isFinite(epoch)) return '시간 미확인'

  const koreaTime = new Date(epoch + (9 * 60 * 60 * 1_000))
  const hour = String(koreaTime.getUTCHours()).padStart(2, '0')
  const minute = String(koreaTime.getUTCMinutes()).padStart(2, '0')
  return `${hour}:${minute}`
}

function visibleMessageContent(message: ConversationMessage) {
  if (message.role === 'user') return message.content

  const sourceLabels: Record<string, string> = { businessContext: '등록된 가게 정보', approvedFacts: '승인된 지식', knowledgeJournal: '지식·업무 일지' }
  const content = message.content
    .replace(/\[(businessContext|approvedFacts|knowledgeJournal)\]/gu, (_, key: string) => `(${sourceLabels[key]})`)
    .replace(internalIdentifierPattern, '확인된 자료')
    .replace(/^\s{0,3}#{1,6}\s+/gmu, '')
    .replace(/\*\*([^*\n]+)\*\*/gu, '$1')
    .replace(/__([^_\n]+)__/gu, '$1')
    .replace(/`([^`\n]+)`/gu, '$1')
    .replace(/^\s*>\s?/gmu, '')
  if (message.role === 'sohee' && message.clarification?.status === 'collecting') {
    const question = message.clarification.question.trim()
    return content.split('\n').filter(line => line.replace(/^\s*\d+\s*\/\s*\d+\s*/u, '').trim() !== question).join('\n').trim()
  }
  return content
}

export function MessageCard({
  attachmentIds = [],
  actions = [],
  artifacts = [],
  evidence = [],
  message,
  onPeriodPlanAction,
  onRetry,
  onRetrySlides,
  planActionsDisabled = false,
  onSubmit,
  workspaceId,
}: MessageCardProps) {
  const r2Mobile = useMobileR2Active()
  const failed = message.status === 'failed'
  const runExternalWrite = useExternalWriteGuard()
  const conversationArtifacts = artifacts.flatMap((artifact) =>
    artifact.kind === 'conversation_artifact' ? [artifact.artifact] : [],
  )
  const liveTimelines = artifacts.filter((artifact) => artifact.kind === 'task_timeline')
  const timelines = message.taskTimeline ? [message.taskTimeline] : liveTimelines
  const otherArtifacts = artifacts.filter((artifact) => artifact.kind !== 'conversation_artifact' && artifact.kind !== 'task_timeline')
  const visibleContent = visibleMessageContent(message)

  return (
    <li className={`${styles.messageRow} ${styles[message.role]}`}>
      <article aria-label={messageLabels[message.role]} className={styles.messageCard}>
        <div className={styles.messageMeta}>
          {message.role === 'sohee' ? <SoheeAvatar variant="message" /> : message.role === 'user' ? (
            <UserAvatar size="message" />
          ) : (
            <span className={styles.messageAvatar} aria-hidden="true">
              <AlertTriangle strokeWidth={1.8} />
            </span>
          )}
          <strong>{messageLabels[message.role]}</strong>
          <time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time>
        </div>
        {message.role === 'sohee' ? timelines.map((timeline) => (
          <ConversationTaskTimeline key={timeline.id} timeline={timeline} messageStatus={message.status} />
        )) : null}
        {visibleContent ? <p>{visibleContent}</p> : null}
        {message.role === 'sohee' && message.interactionDraftsUnavailable ? <Alert><AlertDescription>저장된 답안 결과를 불러오지 못했어요. 소통함에서 최신 답안을 확인해 주세요.</AlertDescription></Alert> : null}
        {message.role === 'sohee' ? message.interactionDrafts?.map(snapshot => (
          <ConversationInteractionDraftCard key={snapshot.id} snapshot={snapshot} threadId={message.threadId}
            readOnly={planActionsDisabled || message.status !== 'completed'} />
        )) : null}
        {message.role === 'sohee' && message.clarification ? (
          <ContentInterviewCard
            attachmentIds={attachmentIds}
            clarification={message.clarification}
            disabled={planActionsDisabled || message.status === 'queued' || message.status === 'streaming'}
            key={`${message.id}-${message.clarification.step}-${message.clarification.status}`}
            onSubmit={onSubmit ?? (() => undefined)}
            workspaceId={workspaceId ?? message.workspaceId}
          />
        ) : null}
        {evidence.length > 0 ? (
          <div aria-label="메시지 근거" className={styles.messageEvidence}>
            <strong>확인한 근거</strong>
            {evidence.map((item) => (
              <Link href={item.href} key={`${item.kind}-${item.id}`}>{item.title}</Link>
            ))}
          </div>
        ) : null}
        {conversationArtifacts.length + otherArtifacts.length > 0 ? (
          <div role="region" aria-label="검토할 제안" className={styles.messageArtifacts}>
            {conversationArtifacts.length > 0 ? (
              <SocialProposalSet
                artifacts={conversationArtifacts}
                onRetrySlides={onRetrySlides}
                replyToMessageId={message.id}
              />
            ) : null}
            {otherArtifacts.map((artifact) => artifact.kind === 'image_draft' ? (
              <figure className={styles.imageArtifact} key={`${artifact.kind}-${artifact.id}`}>
                <div className={styles.imageArtifactFrame}>
                  <Image
                    alt={artifact.title}
                    height={1360}
                    priority={false}
                    src={artifact.previewUrl}
                    unoptimized
                    width={1088}
                  />
                </div>
                <figcaption>
                  <div>
                    <strong>{artifact.title}</strong>
                    <span>{artifact.statusLabel}</span>
                  </div>
                  <Link href={artifact.href}>원본 초안 열기</Link>
                </figcaption>
              </figure>
            ) : artifact.kind === 'period_plan' ? (
              r2Mobile ? (
                <ResearchPlanCard
                  key={`${artifact.kind}-${artifact.id}`}
                  plan={periodPlanToResearchPlan(artifact)}
                  disabled={planActionsDisabled}
                  onRequestChange={onPeriodPlanAction ? () => onPeriodPlanAction('reduce') : undefined}
                  onApprove={onPeriodPlanAction && artifact.status !== 'insufficient' && artifact.expectedRemainingCredits >= 0 ? () => onPeriodPlanAction('confirm') : undefined}
                />
              ) : <PeriodPlanCard
                artifact={artifact}
                disabled={planActionsDisabled}
                key={`${artifact.kind}-${artifact.id}`}
                onAction={onPeriodPlanAction}
              />
            )
              : artifact.kind === 'credit_estimate' ? <CreditEstimateCard artifact={artifact} key={`${artifact.kind}-${artifact.id}`} />
              : isIntegrationArtifact(artifact) ? <IntegrationArtifactRenderer artifact={artifact} key={`${artifact.kind}-${artifact.id}`} />
              : artifact.kind === 'booking_recovery' ? (
                <div key={`${artifact.kind}-${artifact.id}`} className="my-2">
                  <RecoveryCard
                    view={artifact.view}
                    onCommand={async (cmd) => {
                      const wsMatch = typeof window !== 'undefined' ? window.location.pathname.match(/\/workspaces\/([^/]+)/) : null;
                      const wsId = wsMatch?.[1] || '';
                      if (!wsId) return;
                      const post = async () => {
                        const res = await fetch(`/api/workspaces/${wsId}/booking-recovery/cases/${artifact.caseId}/commands`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(cmd),
                        });
                        if (!res.ok) {
                          const json = await res.json().catch(() => ({}));
                          throw new Error(json.error || json.message || '명령 처리에 실패했습니다.');
                        }
                      };
                      // 고객에게 실제로 나가는 명령(답변 발송 승인·예약 확정)만 연결 상태와 중복을 확인한다(ANI-1778).
                      // 초안 준비·거절처럼 서버 안에서 끝나는 명령은 그대로 둔다.
                      const writeKind = cmd.kind === 'approve_send' ? 'send' : cmd.kind === 'approve_booking' || cmd.kind === 'confirm_acceptance' ? 'reservation' : null;
                      if (!writeKind) {
                        await post();
                        return;
                      }
                      const outcome = await runExternalWrite(writeKind, `booking-recovery:${artifact.caseId}:${cmd.kind}`, post);
                      if (!outcome.ran) throw new Error(outcome.decision.message);
                    }}
                  />
                </div>
              )
              : (
              <div className={styles.messageActions} key={`${artifact.kind}-${artifact.id}`}>
                <Link href={artifact.href}>{artifact.title} 검토</Link>
              </div>
            ))}
          </div>
        ) : null}
        {actions.length > 0 ? (
          <div aria-label="메시지 관련 행동" className={styles.messageActions}>
            {actions.map((action) => (
              <Link href={action.href} key={`${action.href}-${action.label}`}>
                {action.label}
              </Link>
            ))}
          </div>
        ) : null}
        {failed ? (
          <div className={styles.messageError} role="alert">
            <span>응답을 마치지 못했어요. 입력 내용은 자동으로 다시 보내지지 않았어요.</span>
            {onRetry ? (
              <button onClick={() => onRetry(message.id)} type="button">
                <RotateCcw aria-hidden="true" strokeWidth={1.8} />
                응답 다시 시도
              </button>
            ) : null}
          </div>
        ) : null}
      </article>
    </li>
  )
}
