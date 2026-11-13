import type { TutorialJourneyProgress } from '@/features/tutorial-journey/tutorial-journey-read-model'
import type { LearningCandidate } from '@/features/onboarding/first-meeting/first-meeting-service'

export interface StateAwareCandidateItem {
  field: string
  value: string
  status: 'CANDIDATE' | 'CONFIRMED'
}

export interface StateAwareSoheeGuidance {
  acknowledgement: string
  understoodCandidates?: StateAwareCandidateItem[]
  nextQuestion: string
  quickReplies: string[]
  stateExplanation?: string
  action?: {
    label: string
    href: string
  }
}

/**
 * [ANI-1448] State-Aware Sohee Guidance Generator
 *
 * Replaces hardcoded scripted messages with canonical truth-aware guidance DTO.
 * Completely eliminates engineering jargon (Harness, HF-, ledger, capability receipt)
 * from owner-facing copy.
 */
export function createStateAwareGuidance(
  progress: TutorialJourneyProgress,
  candidates: LearningCandidate[] = []
): StateAwareSoheeGuidance {
  const understood: StateAwareCandidateItem[] = candidates.map((c) => ({
    field: c.label || c.key,
    value: c.value,
    status: c.status,
  }))

  const baseGuidance = progress.soheeGuidance

  let ack = baseGuidance.acknowledgement
  if (candidates.length > 0) {
    ack = `사장님께서 말씀해 주신 내용을 이렇게 이해했어요: ${candidates.map((c) => c.value).join(', ')}`
  }

  return {
    acknowledgement: ack,
    understoodCandidates: understood.length > 0 ? understood : undefined,
    nextQuestion: baseGuidance.nextQuestion || '다음 단계로 함께 진행해 볼까요?',
    quickReplies: baseGuidance.quickReplies || ['네, 이어서 진행할게요'],
    stateExplanation: baseGuidance.stateExplanation,
    action: {
      label: progress.primaryAction.label,
      href: progress.primaryAction.href,
    },
  }
}
