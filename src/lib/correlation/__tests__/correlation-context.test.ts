import { describe, it, expect } from 'vitest'
import {
  createCorrelationContext,
  deriveNextSpan,
  serializeTraceHeaders,
  deserializeTraceHeaders,
  HEADER_CORRELATION_ID,
  HEADER_TRACE_ID,
  HEADER_SPAN_ID,
  HEADER_STEP,
  type TraceStep,
} from '../correlation-context'

describe('End-to-End Correlation ID & Trace Tracking (ANI-880)', () => {
  it('creates initial correlation context with unique IDs', () => {
    const ctx = createCorrelationContext({
      workspaceId: 'ws-test',
      step: 'CHAT',
      missionId: 'msn-101',
    })

    expect(ctx.correlationId).toMatch(/^corr_/)
    expect(ctx.traceId).toMatch(/^trc_/)
    expect(ctx.spanId).toMatch(/^spn_/)
    expect(ctx.step).toBe('CHAT')
    expect(ctx.workspaceId).toBe('ws-test')
    expect(ctx.missionId).toBe('msn-101')
  })

  it('preserves correlationId across full pipeline steps', () => {
    const steps: TraceStep[] = [
      'CHAT',
      'PLAN',
      'ACTION',
      'PROVIDER',
      'READBACK',
      'EVIDENCE',
      'LEDGER',
      'OUTCOME',
    ]

    let current = createCorrelationContext({
      workspaceId: 'ws-test',
      step: steps[0],
    })
    const rootCorrelationId = current.correlationId
    const rootTraceId = current.traceId

    for (let i = 1; i < steps.length; i++) {
      const next = deriveNextSpan(current, steps[i])
      expect(next.correlationId).toBe(rootCorrelationId)
      expect(next.traceId).toBe(rootTraceId)
      expect(next.parentSpanId).toBe(current.spanId)
      expect(next.spanId).not.toBe(current.spanId)
      expect(next.step).toBe(steps[i])
      current = next
    }

    expect(current.step).toBe('OUTCOME')
    expect(current.correlationId).toBe(rootCorrelationId)
  })

  it('serializes and deserializes HTTP trace headers correctly', () => {
    const original = createCorrelationContext({
      workspaceId: 'ws-edge',
      step: 'ACTION',
      missionId: 'msn-202',
    })

    const headers = serializeTraceHeaders(original)
    expect(headers[HEADER_CORRELATION_ID]).toBe(original.correlationId)
    expect(headers[HEADER_TRACE_ID]).toBe(original.traceId)
    expect(headers[HEADER_SPAN_ID]).toBe(original.spanId)
    expect(headers[HEADER_STEP]).toBe('ACTION')

    const deserialized = deserializeTraceHeaders(headers, 'ws-edge')
    expect(deserialized).not.toBeNull()
    expect(deserialized?.correlationId).toBe(original.correlationId)
    expect(deserialized?.traceId).toBe(original.traceId)
    expect(deserialized?.step).toBe('ACTION')
  })
})
