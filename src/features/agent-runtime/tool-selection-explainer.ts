/**
 * Auto Tool Selection Explainability Engine (ANI-811)
 * 
 * Strict Invariants:
 * 1. Why a tool was selected must be explicitly explained to the owner prior to execution.
 * 2. Explicitly exposes required permissions, estimated credits (in "소희 크레딧"),
 *    external write impact, and approval requirement.
 * 3. Customer-facing credit copy is strictly "소희 크레딧", not raw "SC".
 */

export interface ToolSelectionExplainInput {
  toolId: string
  toolName: string
  intent: string
  riskClass: 'READ' | 'DRAFT' | 'WRITE' | 'SPEND' | 'DELETE'
  estimatedCredits: number
  scopes: string[]
  approvalMode?: 'ALWAYS_ASK' | 'ASK_ON_CHANGE' | 'IMPORTANT_ONLY' | 'GUARDED_AUTO'
  correlationId?: string
}

export interface ToolSelectionExplanation {
  toolId: string
  toolName: string
  selectionReason: string
  requiredPermissions: string[]
  estimatedCreditLabel: string
  estimatedCredits: number
  isExternalWrite: boolean
  requiresApproval: boolean
  approvalNotice: string
  traceId: string
}

export function explainToolSelection(input: ToolSelectionExplainInput): ToolSelectionExplanation {
  const isExternalWrite =
    input.riskClass === 'WRITE' || input.riskClass === 'SPEND' || input.riskClass === 'DELETE'

  // Decide if approval is required based on risk class and approval mode
  let requiresApproval = false
  if (input.approvalMode === 'ALWAYS_ASK') {
    requiresApproval = true
  } else if (input.riskClass === 'SPEND' || input.riskClass === 'DELETE') {
    requiresApproval = true
  } else if (input.riskClass === 'WRITE' && input.approvalMode !== 'GUARDED_AUTO') {
    requiresApproval = true
  }

  const selectionReason = `사장님의 [${input.intent}] 업무 목표를 달성하기 위해 가장 적합한 도구인 [${input.toolName}]을(를) 자동 선택했습니다.`

  const estimatedCreditLabel = `${input.estimatedCredits} 소희 크레딧`

  let approvalNotice = '승인 불필요 (안전 자율 실행)'
  if (requiresApproval) {
    if (input.riskClass === 'SPEND') {
      approvalNotice = '사장님 직접 승인 필요: 외부 광고비 또는 유료 결제가 포함된 작업입니다.'
    } else if (input.riskClass === 'WRITE') {
      approvalNotice = '사장님 확인 권장: 외부 고객 채널에 실제 발행/전송되는 작업입니다.'
    } else {
      approvalNotice = '사장님 확인 필요: 보안 및 데이터 변경 규칙에 따른 사전 확인 단계입니다.'
    }
  }

  return {
    toolId: input.toolId,
    toolName: input.toolName,
    selectionReason,
    requiredPermissions: input.scopes.length > 0 ? input.scopes : ['기본 읽기 권한'],
    estimatedCreditLabel,
    estimatedCredits: input.estimatedCredits,
    isExternalWrite,
    requiresApproval,
    approvalNotice,
    traceId: input.correlationId ?? `trace_${Date.now()}`,
  }
}
