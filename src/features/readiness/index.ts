import type { SoheeReadinessSnapshot } from '@/features/sohee-ready/types'

export type ReadinessStage = 'PREPARE_ONLY' | 'PUBLISH_READY'
export type ReadinessAction = 'ONBOARD' | 'CREATE' | 'PREVIEW' | 'VAULT' | 'COPY_BUNDLE' | 'PUBLISH' | 'SCHEDULE' | 'AUTONOMOUS'

export const CHANNEL_CONNECTION_MESSAGE = '채널을 연결하면 발행할 수 있어요'

/** Server-owned policy matrix; no database/provider dependencies. */
export const READINESS_GATE_MATRIX: Readonly<Record<ReadinessAction, string>> = {
  ONBOARD: 'PREPARE_ONLY', CREATE: 'PREPARE_ONLY', PREVIEW: 'PREPARE_ONLY',
  VAULT: 'PREPARE_ONLY', COPY_BUNDLE: 'PREPARE_ONLY',
  PUBLISH: 'PUBLISH_READY', SCHEDULE: 'PUBLISH_READY', AUTONOMOUS: 'BUSINESS_VERIFIED',
}

const QUICK_FACTS = [
  'BUSINESS_KNOWLEDGE_CONFIRMED', 'TEXT_HARNESS_CONFIRMED',
  'IMAGE_HARNESS_CONFIRMED', 'OPERATING_POLICY_CONFIRMED',
] as const

export interface ReadinessView {
  stage: ReadinessStage
  prepared: boolean
  verifiedChannels: ('instagram' | 'threads')[]
  businessVerified: boolean
  progressPercent: number
  connectionHint: string | null
  trialAutoPublishEnabled: false
}

export function evaluateReadiness(snapshot: SoheeReadinessSnapshot): ReadinessView {
  const verifiedChannels: ReadinessView['verifiedChannels'] = []
  if (snapshot.facts.INSTAGRAM_VERIFIED.verified) verifiedChannels.push('instagram')
  if (snapshot.facts.THREADS_VERIFIED.verified) verifiedChannels.push('threads')
  const prepared = QUICK_FACTS.every((key) => snapshot.facts[key].verified)
  const stage = prepared && verifiedChannels.length > 0 ? 'PUBLISH_READY' : 'PREPARE_ONLY'
  return {
    stage, prepared, verifiedChannels, businessVerified: snapshot.facts.BUSINESS_VERIFIED.verified,
    progressPercent: stage === 'PUBLISH_READY' ? 100 : prepared ? 75 : Math.round(QUICK_FACTS.filter((key) => snapshot.facts[key].verified).length / 4 * 75),
    connectionHint: verifiedChannels.length === 0 ? CHANNEL_CONNECTION_MESSAGE : null,
    trialAutoPublishEnabled: false,
  }
}

export function evaluateGate(readiness: ReadinessView, action: ReadinessAction): { allowed: boolean; message: string | null } {
  const required = READINESS_GATE_MATRIX[action]
  const allowed = required === 'PREPARE_ONLY'
    ? action === 'ONBOARD' || readiness.prepared
    : readiness.stage === 'PUBLISH_READY' && (required !== 'BUSINESS_VERIFIED' || readiness.businessVerified)
  return {
    allowed,
    message: allowed ? null : readiness.verifiedChannels.length === 0 && required !== 'PREPARE_ONLY'
      ? CHANNEL_CONNECTION_MESSAGE
      : required === 'BUSINESS_VERIFIED' ? '사업자 인증이 완료되면 자율 운영할 수 있어요' : '준비를 완료하면 이용할 수 있어요',
  }
}

/** Contract only: ANI-1528 will register a vault re-evaluation listener after verification. */
export type OnChannelVerified = (workspaceId: string, channel: 'instagram' | 'threads') => Promise<void>
