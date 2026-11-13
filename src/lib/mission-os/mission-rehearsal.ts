import crypto from 'node:crypto'
import type { MissionContract } from './mission-contract'
import { validateMissionContract } from './mission-contract'

export interface PreviewRehearsalStep {
  step_id: string
  channel: string
  action_type: string
  summary: string
  simulated_cost_minor_units: number
}

export interface PreviewProofReceipt {
  proof_receipt_id: string
  rehearsal_run_id: string
  mission_id: string
  workspace_id: string
  target_channel: string
  simulated_post_id: string
  preview_permalink: string
  content_preview_text: string
  content_hash_sha256: string
  is_rehearsal: true
  kpi_isolated: true
  verified_at: string
}

export interface RehearsalResult {
  success: boolean
  is_rehearsal: true
  kpi_isolated: true
  live_provider_write_count: 0
  rehearsal_run_id: string
  contract_version: number
  receipts: PreviewProofReceipt[]
  total_simulated_cost_minor_units: number
  timeline_items: {
    id: string
    time: string
    title: string
    status: 'PREVIEW_VERIFIED' | 'PREVIEW_PENDING'
    cost_minor_units: number
  }[]
  created_at: string
}

export interface ChannelAuthorizationCheck {
  channel: string
  is_connected: boolean
  is_authorized: boolean
  token_expired: boolean
}

export interface PreLiveVerificationParams {
  workspaceId: string
  missionId: string
  contract: MissionContract
  channelAuthorizations: ChannelAuthorizationCheck[]
  currentAvailableBudgetMinorUnits: number
  latestFactVersionRef: string
}

export interface PreLiveVerificationResult {
  canPromoteToLive: boolean
  reasons: string[]
  verifiedAt: string
}

/**
 * Runs a deterministic preview rehearsal without calling external providers.
 *
 * Invariants:
 * 1. live_provider_write_count MUST be strictly 0.
 * 2. kpi_isolated MUST be true (never counted in actual analytics or billing).
 * 3. Returns simulated receipts with SHA-256 content hashes for UI preview inspection.
 */
export function runPreviewRehearsal(params: {
  workspaceId: string
  missionId: string
  contract: MissionContract
  steps?: PreviewRehearsalStep[]
}): RehearsalResult {
  const validatedContract = validateMissionContract(params.contract)
  const rehearsalRunId = `reh_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`

  const defaultSteps: PreviewRehearsalStep[] = validatedContract.service_scope.map((channel, idx) => ({
    step_id: `step_${idx + 1}_${channel}`,
    channel,
    action_type: 'PUBLISH_PREVIEW',
    summary: `${channel.toUpperCase()} 가상 발행 리허설`,
    simulated_cost_minor_units: 0,
  }))

  const stepsToRun = params.steps && params.steps.length > 0 ? params.steps : defaultSteps

  const receipts: PreviewProofReceipt[] = []
  const timelineItems: RehearsalResult['timeline_items'] = []
  let totalCost = 0

  for (const step of stepsToRun) {
    const simPostId = `sim_post_${step.channel}_${Date.now()}`
    const previewText = `[리허설 미리보기] ${validatedContract.goal} - 채널: ${step.channel}`
    const contentHash = crypto.createHash('sha256').update(previewText).digest('hex')

    const receipt: PreviewProofReceipt = {
      proof_receipt_id: `rcpt_preview_${crypto.randomBytes(6).toString('hex')}`,
      rehearsal_run_id: rehearsalRunId,
      mission_id: params.missionId,
      workspace_id: params.workspaceId,
      target_channel: step.channel,
      simulated_post_id: simPostId,
      preview_permalink: `https://preview.local/rehearsal/${step.channel}/${simPostId}`,
      content_preview_text: previewText,
      content_hash_sha256: contentHash,
      is_rehearsal: true,
      kpi_isolated: true,
      verified_at: new Date().toISOString(),
    }

    receipts.push(receipt)
    totalCost += step.simulated_cost_minor_units

    timelineItems.push({
      id: `act_${receipt.proof_receipt_id}`,
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      title: step.summary,
      status: 'PREVIEW_VERIFIED',
      cost_minor_units: step.simulated_cost_minor_units,
    })
  }

  return {
    success: true,
    is_rehearsal: true,
    kpi_isolated: true,
    live_provider_write_count: 0,
    rehearsal_run_id: rehearsalRunId,
    contract_version: validatedContract.contract_version,
    receipts,
    total_simulated_cost_minor_units: totalCost,
    timeline_items: timelineItems,
    created_at: new Date().toISOString(),
  }
}

/**
 * Re-evaluates facts, account authorization, and budget before promoting from rehearsal to live.
 *
 * Invariants:
 * - If any service_scope channel is unauthorized or disconnected -> BLOCKED.
 * - If available budget < contract max_cost_minor_units -> BLOCKED.
 * - If fact version has changed or expired -> BLOCKED.
 */
export function verifyPreLiveInvariants(params: PreLiveVerificationParams): PreLiveVerificationResult {
  const { contract, channelAuthorizations, currentAvailableBudgetMinorUnits, latestFactVersionRef } = params
  const reasons: string[] = []

  // 1. Channel connection & authorization verification
  for (const scopeChannel of contract.service_scope) {
    const auth = channelAuthorizations.find(
      (a) => a.channel.toLowerCase() === scopeChannel.toLowerCase()
    )
    if (!auth || !auth.is_connected) {
      reasons.push(`채널 '${scopeChannel}'이(가) 연결되어 있지 않습니다. 계정 연결이 필요합니다.`)
    } else if (!auth.is_authorized || auth.token_expired) {
      reasons.push(`채널 '${scopeChannel}'의 계정 권한이 만료되었거나 권한이 부족합니다. 재인증이 필요합니다.`)
    }
  }

  // 2. Budget verification (fail-closed on NaN, non-finite, negative, or insufficient budget)
  if (
    typeof currentAvailableBudgetMinorUnits !== 'number' ||
    !Number.isFinite(currentAvailableBudgetMinorUnits) ||
    Number.isNaN(currentAvailableBudgetMinorUnits) ||
    currentAvailableBudgetMinorUnits < 0
  ) {
    reasons.push('가용 잔여 예산 정보가 유효한 비음수 숫자가 아닙니다.')
  } else if (currentAvailableBudgetMinorUnits < contract.budget_caps.max_cost_minor_units) {
    reasons.push(
      `가용 잔여 예산(${currentAvailableBudgetMinorUnits.toLocaleString()}원)이 계약 필요 예산(${contract.budget_caps.max_cost_minor_units.toLocaleString()}원)보다 부족합니다.`
    )
  }

  // 3. Fact version fresh check (fail-closed on missing or empty latestFactVersionRef)
  if (
    typeof latestFactVersionRef !== 'string' ||
    latestFactVersionRef.trim() === ''
  ) {
    reasons.push('최신 매장 기초 사실(Fact) 버전 참조값이 비어있거나 유효하지 않습니다.')
  } else if (
    contract.fact_version_refs &&
    typeof contract.fact_version_refs === 'object' &&
    Object.keys(contract.fact_version_refs).length > 0
  ) {
    const expectedFact = (contract.fact_version_refs as Record<string, string>)['base_fact'] ||
                         (contract.fact_version_refs as Record<string, string>)['store_fact']
    if (expectedFact && expectedFact !== latestFactVersionRef) {
      reasons.push(
        `매장 기초 사실(Fact) 버전이 변경되었습니다. 최신 매장 정보를 기준으로 계획을 재검토해야 합니다.`
      )
    }
  }

  // 4. Contract Expiration & Approval Invariant Verification
  const expiresAtTime = Date.parse(contract.expires_at)
  if (Number.isNaN(expiresAtTime) || Date.now() > expiresAtTime) {
    reasons.push(`계약 만료 시각('${contract.expires_at}')이 지났거나 유효하지 않습니다.`)
  }

  if (
    typeof contract.approval_fingerprint !== 'string' ||
    contract.approval_fingerprint.trim() === ''
  ) {
    reasons.push('계약에 유효한 승인 지문(approval_fingerprint)이 없습니다. 사전 승인이 완료되어야 실서비스로 전환할 수 있습니다.')
  }

  return {
    canPromoteToLive: reasons.length === 0,
    reasons,
    verifiedAt: new Date().toISOString(),
  }
}

/**
 * Promotes a rehearsal mission to live execution state if and only if preflight verification succeeds.
 */
export function promoteRehearsalToLive(
  rehearsalResult: RehearsalResult,
  verification: PreLiveVerificationResult,
  currentContractVersion?: number
): {
  promoted: boolean
  mode: 'LIVE' | 'REHEARSAL'
  error?: string
} {
  if (!rehearsalResult.is_rehearsal) {
    return {
      promoted: false,
      mode: 'REHEARSAL',
      error: '[INVALID_REHEARSAL] Input is not a valid rehearsal result',
    }
  }

  if (
    currentContractVersion !== undefined &&
    rehearsalResult.contract_version !== undefined &&
    rehearsalResult.contract_version !== currentContractVersion
  ) {
    return {
      promoted: false,
      mode: 'REHEARSAL',
      error: `[STALE_REHEARSAL_VERSION] 리허설 계약 버전(${rehearsalResult.contract_version})이 현재 계약 버전(${currentContractVersion})과 다릅니다. 최신 계약으로 리허설을 다시 실행해 주세요.`,
    }
  }

  if (!verification.canPromoteToLive) {
    return {
      promoted: false,
      mode: 'REHEARSAL',
      error: `[LIVE_PROMOTION_BLOCKED] 실서비스 전환 사전 검증 실패: ${verification.reasons.join(', ')}`,
    }
  }

  return {
    promoted: true,
    mode: 'LIVE',
  }
}
