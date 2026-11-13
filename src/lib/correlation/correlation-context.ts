/**
 * End-to-End Correlation ID & Trace Tracking (ANI-880)
 * 
 * Invariants:
 * 1. Single unified correlation_id flows unbroken through:
 *    CHAT -> PLAN -> ACTION -> PROVIDER -> READBACK -> EVIDENCE -> LEDGER -> OUTCOME
 * 2. Every log, ledger entry, and proof artifact references the correlation_id.
 * 3. Standard HTTP headers propagated across internal and external worker boundaries.
 */

export type TraceStep =
  | 'CHAT'
  | 'PLAN'
  | 'ACTION'
  | 'PROVIDER'
  | 'READBACK'
  | 'EVIDENCE'
  | 'LEDGER'
  | 'OUTCOME'

export interface CorrelationContext {
  correlationId: string
  traceId: string
  spanId: string
  parentSpanId?: string
  step: TraceStep
  workspaceId: string
  missionId?: string
  createdAt: string
}

export const HEADER_CORRELATION_ID = 'x-sohee-correlation-id'
export const HEADER_TRACE_ID = 'x-sohee-trace-id'
export const HEADER_SPAN_ID = 'x-sohee-span-id'
export const HEADER_STEP = 'x-sohee-step'

function generateId(prefix: string): string {
  const rand = Math.random().toString(36).substring(2, 10)
  const time = Date.now().toString(36)
  return `${prefix}_${time}_${rand}`
}

export function createCorrelationContext(input: {
  workspaceId: string
  step?: TraceStep
  missionId?: string
  correlationId?: string
}): CorrelationContext {
  const correlationId = input.correlationId ?? generateId('corr')
  const traceId = generateId('trc')
  const spanId = generateId('spn')

  return {
    correlationId,
    traceId,
    spanId,
    step: input.step ?? 'CHAT',
    workspaceId: input.workspaceId,
    missionId: input.missionId,
    createdAt: new Date().toISOString(),
  }
}

export function deriveNextSpan(
  current: CorrelationContext,
  nextStep: TraceStep,
  overrideMissionId?: string
): CorrelationContext {
  return {
    correlationId: current.correlationId,
    traceId: current.traceId,
    spanId: generateId('spn'),
    parentSpanId: current.spanId,
    step: nextStep,
    workspaceId: current.workspaceId,
    missionId: overrideMissionId ?? current.missionId,
    createdAt: new Date().toISOString(),
  }
}

export function serializeTraceHeaders(context: CorrelationContext): Record<string, string> {
  const headers: Record<string, string> = {
    [HEADER_CORRELATION_ID]: context.correlationId,
    [HEADER_TRACE_ID]: context.traceId,
    [HEADER_SPAN_ID]: context.spanId,
    [HEADER_STEP]: context.step,
  }
  return headers
}

export function deserializeTraceHeaders(
  headers: Headers | Record<string, string | string[] | undefined>,
  fallbackWorkspaceId: string = 'ws-default'
): CorrelationContext | null {
  const getHeader = (name: string): string | null => {
    if (typeof (headers as Headers).get === 'function') {
      return (headers as Headers).get(name)
    }
    const val = (headers as Record<string, string | string[] | undefined>)[name]
    if (Array.isArray(val)) return val[0] ?? null
    return val ?? null
  }

  const correlationId = getHeader(HEADER_CORRELATION_ID)
  if (!correlationId) return null

  const traceId = getHeader(HEADER_TRACE_ID) ?? generateId('trc')
  const spanId = getHeader(HEADER_SPAN_ID) ?? generateId('spn')
  const rawStep = getHeader(HEADER_STEP) as TraceStep | null
  const step: TraceStep = rawStep ?? 'ACTION'

  return {
    correlationId,
    traceId,
    spanId,
    step,
    workspaceId: fallbackWorkspaceId,
    createdAt: new Date().toISOString(),
  }
}
