import type { SpecEvaluationResult, ChannelType } from '@/features/vault/channel-spec/types'
import { CHANNEL_CONNECTION_MESSAGE, type ReadinessStage } from '@/features/readiness'

export type ApprovalAction = 'VAULT' | 'PUBLISH' | 'SCHEDULE'
export type ProviderReviewStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'UNKNOWN'
export type ApprovalConnection = 'VERIFIED' | 'CONNECTED' | 'DISCONNECTED' | 'EXPIRED' | 'UNKNOWN'
export interface ApprovalActionInput {
  channel: ChannelType
  readiness: ReadinessStage
  connection: ApprovalConnection
  providerReviewStatus: ProviderReviewStatus
  specResult: Pick<SpecEvaluationResult, 'blocksVault'>
  targetTime: string | null
}
export interface ActionVerdict { allowed: boolean; message: string | null }
export type ApprovalActionVerdicts = Record<ApprovalAction, ActionVerdict>

/** A held item has never been queued for external publication. */
export const VAULT_APPROVAL_LABEL = '발행 준비 완료 · 외부 게시 전'
const allowed: ActionVerdict = { allowed: true, message: null }
const blocked = (message: string): ActionVerdict => ({ allowed: false, message })

/** Pure per-target verdicts. Never infer a default choice: caller must explicitly select an action. */
export function evaluateApprovalActions(input: ApprovalActionInput): ApprovalActionVerdicts {
  const vault = input.specResult.blocksVault
    ? blocked('채널 규격을 수정한 뒤 보관할 수 있어요') : allowed
  let publish: ActionVerdict
  if (input.channel === 'naver_blog') publish = blocked('네이버 연동은 준비 중이에요')
  else if (input.channel === 'daangn_business') publish = blocked('당근 연동은 준비 중이에요')
  else if (input.connection !== 'VERIFIED' || input.readiness !== 'PUBLISH_READY') publish = blocked(CHANNEL_CONNECTION_MESSAGE)
  else if (input.providerReviewStatus !== 'APPROVED') publish = blocked('Meta 앱 심사가 끝나면 열려요')
  else publish = allowed

  const hasTime = input.targetTime !== null && Number.isFinite(Date.parse(input.targetTime))
  const schedule = !publish.allowed ? publish : hasTime ? allowed : blocked('예정 시각을 입력하면 예약할 수 있어요')
  return { VAULT: vault, PUBLISH: publish, SCHEDULE: schedule }
}

export function listAvailableApprovalActions(input: ApprovalActionInput): ApprovalAction[] {
  const verdicts = evaluateApprovalActions(input)
  return (['VAULT', 'PUBLISH', 'SCHEDULE'] as const).filter((action) => verdicts[action].allowed)
}
