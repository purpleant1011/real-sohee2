import 'server-only'

import type { SupervisedSessionBroker, PrepareSupervisedSessionInput, ExecuteSupervisedSessionInput } from './session-broker'
import type { BrokerFailure, ExternalExecutionResult } from './types'

const unavailable: BrokerFailure = Object.freeze({
  ok: false,
  code: 'BROKER_UNAVAILABLE',
  status: 'manual_assist_required',
})

export class UnavailableSessionBroker implements SupervisedSessionBroker {
  async prepare(_input: PrepareSupervisedSessionInput): Promise<BrokerFailure> {
    void _input
    return unavailable
  }

  async execute(_input: ExecuteSupervisedSessionInput): Promise<ExternalExecutionResult> {
    void _input
    return unavailable
  }
}
