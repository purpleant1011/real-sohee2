import 'server-only'

import type { ExternalActionCreditPort } from '../external-action-credit-port'
import type { SupervisedSessionBroker } from '../session-broker'
import type { ApprovedExternalAction, ExternalExecutionResult } from '../types'

export async function executeApprovedAction(
  action: ApprovedExternalAction,
  dependencies: Readonly<{
    broker: SupervisedSessionBroker
    sessionReferenceId: string
    credits: ExternalActionCreditPort
  }>,
): Promise<ExternalExecutionResult> {
  const result = await dependencies.broker.execute({ action, sessionReferenceId: dependencies.sessionReferenceId })
  if (!result.ok && result.code === 'BROKER_UNAVAILABLE') {
    await dependencies.credits.releaseExternalActionCredit({
      workspaceId: action.workspaceId,
      approvalFingerprint: action.approval.fingerprint,
      reason: 'BROKER_UNAVAILABLE',
    })
  }
  return result
}
