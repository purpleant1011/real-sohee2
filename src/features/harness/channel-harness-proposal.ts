import type { ActionResult } from '@/lib/errors/result'
import { channelHarnessSchema, type ChannelHarness } from './channel-harness-schema'
import type { ChannelHarnessProvider, GenerationCreditPort } from './channel-harness-provider'

type HarnessFactsPort = Readonly<{ listApproved(workspaceId: string): Promise<readonly string[]> }>
type CandidateRepository = Readonly<{
  saveCandidate(input: Readonly<{ workspaceId: string; status: 'review_required'; harness: ChannelHarness; sourceFactIds: readonly string[] }>): Promise<Readonly<{ ruleId: string; status: 'review_required' }>>
}>
type Dependencies = Readonly<{ facts: HarnessFactsPort; credits: GenerationCreditPort; provider: ChannelHarnessProvider; repository: CandidateRepository }>

function failure(message: string, requestId: string): ActionResult<Readonly<{ ruleId: string; status: 'review_required' }>> { return { error: { message, requestId } } }

export async function proposeChannelHarness(input: Readonly<{ workspaceId: string }>, dependencies: Dependencies): Promise<ActionResult<Readonly<{ ruleId: string; status: 'review_required' }>>> {
  const approvedFactIds = await dependencies.facts.listApproved(input.workspaceId)
  if (approvedFactIds.length === 0) return failure('승인된 사실이 없어 하네스를 제안할 수 없습니다.', 'channel-harness-facts')
  const reservation = await dependencies.credits.reserve({ workspaceId: input.workspaceId, operation: 'channel_harness' })
  try {
    const harness = channelHarnessSchema.parse(await dependencies.provider.propose({ workspaceId: input.workspaceId, approvedFactIds }))
    if (harness.sourceFactIds.some((id) => !approvedFactIds.includes(id))) throw new Error('unapproved_source_fact')
    const candidate = await dependencies.repository.saveCandidate({ workspaceId: input.workspaceId, status: 'review_required', harness, sourceFactIds: harness.sourceFactIds })
    await dependencies.credits.settle(reservation.reservationId)
    return { data: candidate }
  } catch {
    await dependencies.credits.release(reservation.reservationId)
    return failure('하네스 제안을 저장하지 못했습니다.', 'channel-harness-provider')
  }
}
