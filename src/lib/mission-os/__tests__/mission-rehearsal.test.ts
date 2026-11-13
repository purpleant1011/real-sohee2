import { describe, it, expect } from 'vitest'
import {
  runPreviewRehearsal,
  verifyPreLiveInvariants,
  promoteRehearsalToLive,
} from '../mission-rehearsal'
import type { MissionContract } from '../mission-contract'

function createContract(): MissionContract {
  return {
    contract_version: 1,
    goal: '인스타그램 주말 예약 5건 채우기',
    success_criterion: {
      metric: 'verified_reservations',
      target_value: 5,
      baseline_value: 0,
      unit: '건',
    },
    observation_window: {
      start_at: '2026-10-27T00:00:00.000Z',
      end_at: '2026-11-03T00:00:00.000Z',
      evaluation_interval_hours: 6,
    },
    service_scope: ['instagram'],
    allowed_actions: ['PUBLISH_POST'],
    forbidden_actions: ['DISCOUNT_OVER_30_PERCENT'],
    budget_caps: {
      max_cost_minor_units: 3000000, // 30,000 KRW
      currency: 'KRW',
    },
    attention_policy: {
      max_escalations: 1,
      notify_on_breach: true,
    },
    fact_version_refs: { base_fact: 'fact_v1' },
    policy_version: '2026-10-v1',
    approval_fingerprint: 'a'.repeat(64),
    owner_actor: {
      actor_type: 'user',
      actor_id: 'user_1',
    },
    effective_at: '2026-10-27T00:00:00.000Z',
    expires_at: '2099-12-31T23:59:59.000Z',
  }
}

describe('ANI-1880: Preview Rehearsal & Live Preflight Gate', () => {
  it('runPreviewRehearsal guarantees live_provider_write_count = 0 and kpi_isolated = true', () => {
    const contract = createContract()
    const result = runPreviewRehearsal({
      workspaceId: 'ws_test',
      missionId: 'msn_reh_1',
      contract,
    })

    expect(result.success).toBe(true)
    expect(result.is_rehearsal).toBe(true)
    expect(result.kpi_isolated).toBe(true)
    expect(result.live_provider_write_count).toBe(0)
    expect(result.receipts).toHaveLength(1)
    expect(result.receipts[0].is_rehearsal).toBe(true)
    expect(result.receipts[0].kpi_isolated).toBe(true)
    expect(result.receipts[0].content_hash_sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('verifyPreLiveInvariants blocks promotion when target channel is disconnected or unauthorized', () => {
    const contract = createContract()
    const verification = verifyPreLiveInvariants({
      workspaceId: 'ws_test',
      missionId: 'msn_reh_1',
      contract,
      channelAuthorizations: [
        {
          channel: 'instagram',
          is_connected: false,
          is_authorized: false,
          token_expired: true,
        },
      ],
      currentAvailableBudgetMinorUnits: 5000000,
      latestFactVersionRef: 'fact_v1',
    })

    expect(verification.canPromoteToLive).toBe(false)
    expect(verification.reasons.some((r) => r.includes('연결되어 있지 않습니다'))).toBe(true)

    const rehearsal = runPreviewRehearsal({
      workspaceId: 'ws_test',
      missionId: 'msn_reh_1',
      contract,
    })
    const promo = promoteRehearsalToLive(rehearsal, verification)
    expect(promo.promoted).toBe(false)
    expect(promo.mode).toBe('REHEARSAL')
    expect(promo.error).toContain('LIVE_PROMOTION_BLOCKED')
  })

  it('verifyPreLiveInvariants blocks promotion when budget is insufficient', () => {
    const contract = createContract()
    const verification = verifyPreLiveInvariants({
      workspaceId: 'ws_test',
      missionId: 'msn_reh_1',
      contract,
      channelAuthorizations: [
        {
          channel: 'instagram',
          is_connected: true,
          is_authorized: true,
          token_expired: false,
        },
      ],
      currentAvailableBudgetMinorUnits: 10000, // Available: 10,000 KRW < Required: 3,000,000 KRW
      latestFactVersionRef: 'fact_v1',
    })

    expect(verification.canPromoteToLive).toBe(false)
    expect(verification.reasons.some((r) => r.includes('가용 잔여 예산'))).toBe(true)
  })

  it('verifyPreLiveInvariants blocks promotion when store fact version has changed', () => {
    const contract = createContract()
    const verification = verifyPreLiveInvariants({
      workspaceId: 'ws_test',
      missionId: 'msn_reh_1',
      contract,
      channelAuthorizations: [
        {
          channel: 'instagram',
          is_connected: true,
          is_authorized: true,
          token_expired: false,
        },
      ],
      currentAvailableBudgetMinorUnits: 10000000,
      latestFactVersionRef: 'fact_v2_updated', // Diverged from fact_v1 in contract
    })

    expect(verification.canPromoteToLive).toBe(false)
    expect(verification.reasons.some((r) => r.includes('매장 기초 사실(Fact) 버전이 변경'))).toBe(true)
  })

  it('promotes rehearsal to live when all facts, accounts, and budgets are fully verified', () => {
    const contract = createContract()
    const verification = verifyPreLiveInvariants({
      workspaceId: 'ws_test',
      missionId: 'msn_reh_1',
      contract,
      channelAuthorizations: [
        {
          channel: 'instagram',
          is_connected: true,
          is_authorized: true,
          token_expired: false,
        },
      ],
      currentAvailableBudgetMinorUnits: 10000000,
      latestFactVersionRef: 'fact_v1',
    })

    expect(verification.canPromoteToLive).toBe(true)
    expect(verification.reasons).toHaveLength(0)

    const rehearsal = runPreviewRehearsal({
      workspaceId: 'ws_test',
      missionId: 'msn_reh_1',
      contract,
    })
    const promo = promoteRehearsalToLive(rehearsal, verification)
    expect(promo.promoted).toBe(true)
    expect(promo.mode).toBe('LIVE')
  })
})
