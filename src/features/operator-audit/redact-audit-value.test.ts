import { describe, expect, it } from 'vitest'
import {
  MAX_AUDIT_ARRAY_ITEMS,
  MAX_AUDIT_BYTES,
  MAX_AUDIT_DEPTH,
  MAX_AUDIT_OBJECT_KEYS,
  MAX_AUDIT_STRING_LENGTH,
  redactAuditValue,
} from './redact-audit-value'

describe('redactAuditValue', () => {
  it('redacts sensitive keys at every depth while preserving safe facts', () => {
    const input = {
      password: 'value',
      status: 'active',
      nested: { access_token: 'secret', safe_code: 'READY' },
      list: [{ Authorization: 'Bearer hidden', fingerprint: 'a'.repeat(64) }],
    }

    expect(redactAuditValue(input)).toEqual({
      password: '[REDACTED]',
      status: 'active',
      nested: { access_token: '[REDACTED]', safe_code: 'READY' },
      list: [{ Authorization: '[REDACTED]', fingerprint: 'a'.repeat(64) }],
    })
    expect(input.nested.access_token).toBe('secret')
  })

  it.each([
    'Bearer abc.def.ghi',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
    'https://user:password@example.com/private',
    'https://provider.example/callback?access_token=secret',
    'sk-live-secret-value',
    'sk-genericsecretvalue',
    'sk-proj-projectsecretvalue',
    'https://example.com/invite?invite_link=private-value',
    'https://example.com/recovery#recovery_code=private-value',
  ])('redacts credential-shaped string values: %s', (value) => {
    expect(redactAuditValue({ note: value })).toEqual({ note: '[REDACTED]' })
  })

  it('preserves safe-looking keys that are not exact secret names', () => {
    expect(redactAuditValue({
      token_count: 3,
      secretary: 'active',
      password_policy: 'strong',
      invite_link_status: 'ready',
      recovery_code_count: 0,
    })).toEqual({
      token_count: 3,
      secretary: 'active',
      password_policy: 'strong',
      invite_link_status: 'ready',
      recovery_code_count: 0,
    })
  })

  it('replaces raw errors without exposing message, details, hint, or stack', () => {
    const error = Object.assign(new Error('provider body secret'), {
      details: 'sql details',
      hint: 'raw hint',
    })

    expect(redactAuditValue({ error })).toEqual({ error: '[REDACTED_ERROR]' })
    expect(JSON.stringify(redactAuditValue(error))).not.toContain('provider body secret')
  })

  it('exports and enforces every fixed structural limit with whole-value markers', () => {
    expect({
      MAX_AUDIT_DEPTH,
      MAX_AUDIT_OBJECT_KEYS,
      MAX_AUDIT_ARRAY_ITEMS,
      MAX_AUDIT_STRING_LENGTH,
      MAX_AUDIT_BYTES,
    }).toEqual({
      MAX_AUDIT_DEPTH: 6,
      MAX_AUDIT_OBJECT_KEYS: 64,
      MAX_AUDIT_ARRAY_ITEMS: 64,
      MAX_AUDIT_STRING_LENGTH: 2000,
      MAX_AUDIT_BYTES: 16000,
    })

    expect(redactAuditValue('x'.repeat(2001))).toBe('[LIMIT_EXCEEDED]')
    expect(redactAuditValue(Array.from({ length: 65 }, (_, index) => index))).toBe('[LIMIT_EXCEEDED]')
    expect(redactAuditValue(Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`k${index}`, index])))).toBe('[LIMIT_EXCEEDED]')

    let deep: unknown = 'safe'
    for (let depth = 0; depth <= 6; depth += 1) deep = { child: deep }
    expect(JSON.stringify(redactAuditValue(deep))).toContain('[LIMIT_EXCEEDED]')

    const byteHeavy = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`k${index}`, '가'.repeat(300)]))
    expect(redactAuditValue(byteHeavy)).toBe('[LIMIT_EXCEEDED]')
  })

  it('uses fixed safe markers for circular, getter, proxy, function, symbol, and class values', () => {
    const circular: Record<string, unknown> = { status: 'active' }
    circular.self = circular
    const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { throw new Error('leak') } })
    const proxy = new Proxy({}, { ownKeys() { throw new Error('proxy leak') } })

    class UnknownValue { readonly value = 'hidden' }

    expect(redactAuditValue(circular)).toEqual({ status: 'active', self: '[UNAVAILABLE]' })
    expect(redactAuditValue(getter)).toEqual({ value: '[UNAVAILABLE]' })
    expect(redactAuditValue(proxy)).toBe('[UNAVAILABLE]')
    expect(redactAuditValue({ fn: () => 'secret', symbol: Symbol('secret'), instance: new UnknownValue() })).toEqual({
      fn: '[UNAVAILABLE]',
      symbol: '[UNAVAILABLE]',
      instance: '[UNAVAILABLE]',
    })
  })

  it('is deterministic for the same immutable input', () => {
    const input = Object.freeze({ status: 'approved', requestId: 'safe-request' })
    expect(redactAuditValue(input)).toEqual(redactAuditValue(input))
    expect(input).toEqual({ status: 'approved', requestId: 'safe-request' })
  })
})
