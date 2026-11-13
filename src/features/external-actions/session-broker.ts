import 'server-only'

import type { ApprovedExternalAction, BrokerFailure, ExternalExecutionResult } from './types'

export type PreparedSession = Readonly<{
  actionId: string
  sessionReferenceId: string
  targetExternalId: string
}>

export type PrepareSupervisedSessionInput = Readonly<{
  action: ApprovedExternalAction
  sessionReferenceId: string
}>

export type ExecuteSupervisedSessionInput = PrepareSupervisedSessionInput

export interface SupervisedSessionBroker {
  prepare(input: PrepareSupervisedSessionInput): Promise<PreparedSession | BrokerFailure>
  execute(input: ExecuteSupervisedSessionInput): Promise<ExternalExecutionResult>
}
