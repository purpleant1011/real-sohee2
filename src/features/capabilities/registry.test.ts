import { describe, expect, it } from 'vitest'
import { evaluateCapability, isRecoveryRolloutEnabled } from './registry'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const now = new Date('2026-10-21T10:00:00Z')
const env = { NODE_ENV: 'production', META_LIVE_WORKSPACE_ALLOWLIST: workspaceId, ENGAGEMENT_WORKSPACE_ALLOWLIST: workspaceId, ENGAGEMENT_SEND_ENABLED: '1', BOOKING_RECOVERY_ENABLED: '1', BOOKING_RECOVERY_WORKSPACE_ALLOWLIST: workspaceId }
const permission = { workspaceId, provider: 'instagram' as const, connected: true, grantedScopes: ['instagram_business_basic', 'instagram_business_content_publish'], verifiedAt: '2026-10-21T09:00:00Z', expiresAt: '2026-10-22T09:00:00Z' }
const input = { workspaceId, action: 'publish' as const, provider: 'instagram' as const, permission, env, now }

describe('action capability registry', () => {
  it('publish permission is not message or reply permission', () => {
    expect(evaluateCapability(input).ready).toBe(true)
    for (const action of ['reply', 'message'] as const) {
      const result = evaluateCapability({ ...input, action })
      expect(result).toMatchObject({ ready: false, reason: 'SCOPE_MISSING' })
      expect(result.manualAlternative.length).toBeGreaterThan(0)
    }
  })
  it('connected without scope or independent verification stays blocked', () => {
    expect(evaluateCapability({ ...input, permission: { ...permission, grantedScopes: [] } }).ready).toBe(false)
    expect(evaluateCapability({ ...input, permission: { ...permission, verifiedAt: null } }).reason).toBe('PERMISSION_NOT_VERIFIED')
    expect(evaluateCapability({ ...input, permission: { ...permission, verifiedAt: 'invalid' } }).ready).toBe(false)
    expect(evaluateCapability({ ...input, permission: { ...permission, verifiedAt: '2026-10-22T09:00:00Z' } }).ready).toBe(false)
  })
  it('rejects another workspace or provider permission evidence', () => {
    expect(evaluateCapability({ ...input, permission: { ...permission, workspaceId: '22222222-2222-4222-8222-222222222222' } }).ready).toBe(false)
    expect(evaluateCapability({ ...input, provider: 'threads' }).ready).toBe(false)
  })
  it('permits only the exact supported message scope and rejects stale verification', () => {
    const message = { ...permission, grantedScopes: ['instagram_business_manage_messages'] }
    expect(evaluateCapability({ ...input, action: 'message', permission: message }).ready).toBe(true)
    expect(evaluateCapability({ ...input, action: 'reply', permission: message }).ready).toBe(false)
    expect(evaluateCapability({ ...input, permission: { ...permission, verifiedAt: '2026-10-01T09:00:00Z' } }).ready).toBe(false)
  })
  it('expired credentials and production wildcard cannot execute', () => {
    expect(evaluateCapability({ ...input, permission: { ...permission, expiresAt: now.toISOString() } }).ready).toBe(false)
    expect(evaluateCapability({ ...input, env: { ...env, META_LIVE_WORKSPACE_ALLOWLIST: '*' } }).ready).toBe(false)
  })
  it('kill switch blocks ready providers without invoking any external operation', () => {
    let calls = 0
    const result = evaluateCapability({ ...input, env: { ...env, KILL_SWITCH: '1' } })
    if (result.ready) calls++
    expect(calls).toBe(0)
    expect(result.reason).toBe('KILL_SWITCH_ACTIVE')
  })
  it('booking default OFF, unknown workspace and empty allowlist fail closed', () => {
    expect(isRecoveryRolloutEnabled(workspaceId, true, {})).toBe(false)
    expect(isRecoveryRolloutEnabled('unknown', true, env)).toBe(false)
    expect(isRecoveryRolloutEnabled(workspaceId, true, { ...env, BOOKING_RECOVERY_WORKSPACE_ALLOWLIST: '' })).toBe(false)
    expect(isRecoveryRolloutEnabled(workspaceId, true, { ...env, BOOKING_RECOVERY_KILL_SWITCH: '1' })).toBe(false)
    expect(isRecoveryRolloutEnabled(workspaceId, false, { ...env, BOOKING_RECOVERY_KILL_SWITCH: '1' })).toBe(true)
  })
  it('payment and refund require their own verified contract and exact enable switch', () => {
    for (const action of ['payment', 'refund'] as const) {
      const base = { workspaceId, action, provider: 'portone' as const, now, env: { ...env, PAYMENT_ENABLED: '1', REFUND_ENABLED: '1', PAYMENT_WORKSPACE_ALLOWLIST: workspaceId } }
      expect(evaluateCapability(base).ready).toBe(false)
      expect(evaluateCapability({ ...base, contract: { workspaceId, provider: 'portone', verifiedAt: '2026-10-21T09:00:00Z' } }).ready).toBe(false)
    }
  })
})
