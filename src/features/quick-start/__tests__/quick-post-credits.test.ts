import { beforeEach, describe, expect, it, vi } from 'vitest'

const compose = vi.hoisted(() => vi.fn())
const image = vi.hoisted(() => vi.fn())
vi.mock('@/features/missions/conversational-first-post', () => ({
  calculateApprovalFingerprint: () => 'fingerprint',
}))
vi.mock('../quick-copy', () => ({ composeQuickPostCopy: compose }))
vi.mock('../quick-image', () => ({ generateAndStoreQuickImage: image }))

import { createQuickDraft, QuickPostError, reviseQuickDraft } from '../quick-post-service'
import { resolveApprovedFacts } from '@/features/knowledge/approved-fact-resolver'
import {
  reserveQuickPostCredits,
  settleQuickPostCredits,
  releaseQuickPostCredits,
  QuickPostCreditFailure,
} from '../quick-post-credits'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const missionId = '20000000-0000-4000-8000-000000000002'
const copies = { instagram: { caption: '매장 소개', hashtags: [] }, threads: { content: '매장 소개' } }

type Reservation = { reservationId: string; state: 'reserved' | 'settled' | 'released'; requestedCredits: number; key: string }

function fakeAdmin(initialBalance = 300, startingMission?: any) {
  let available = initialBalance
  let charged = 0
  let currentMission = startingMission
  const reservations = new Map<string, Reservation>()
  const events: string[] = []
  const admin: any = {
    events,
    facts: [],
    get available() { return available },
    get charged() { return charged },
    get mission() { return currentMission },
    reservations,
    rpc: vi.fn(async (name: string, args: Record<string, any>) => {
      if (name === 'get_workspace_membership_tier') return { data: 'TRIAL', error: null }
      events.push(name)
      if (name === 'reserve_quick_post_credits') {
        const existing = reservations.get(`quick-post:${args.p_mission_id}:${args.p_revision}:${args.p_scope}`)
        if (existing) return { data: { ...existing, isReplay: true }, error: null }
        if (available < args.p_credits) return { data: { state: 'insufficient', availableCredits: available }, error: null }
        available -= args.p_credits
        const item: Reservation = { reservationId: args.p_reservation_id, state: 'reserved', requestedCredits: args.p_credits, key: `quick-post:${args.p_mission_id}:${args.p_revision}:${args.p_scope}` }
        reservations.set(item.key, item)
        return { data: { ...item, isReplay: false }, error: null }
      }
      if (name === 'settle_quick_post_credits') {
        const item = [...reservations.values()].find((row) => row.reservationId === args.p_reservation_id)!
        if (item.state === 'reserved') { item.state = 'settled'; charged += item.requestedCredits }
        return { data: { reservationId: item.reservationId, state: item.state }, error: null }
      }
      if (name === 'release_quick_post_credits') {
        const item = [...reservations.values()].find((row) => row.reservationId === args.p_reservation_id)!
        if (item.state === 'reserved') { item.state = 'released'; available += item.requestedCredits }
        return { data: { reservationId: item.reservationId, state: item.state }, error: null }
      }
      if (name === 'get_workspace_membership_tier') return { data: 'TRIAL', error: null }
      return { data: null, error: { message: 'unknown rpc' } }
    }),
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const chain: any = {
        select: () => chain, eq: (k: string, v: unknown) => { filters[k] = v; return chain },
        gte: () => chain, in: () => chain, not: () => chain, limit: () => chain, order: () => chain,
        maybeSingle: async () => {
          if (table === 'marketing_missions') return { data: currentMission, error: null }
          const row: Record<string, any> = {
            business_profiles: { business_name: '모모 카페', industry: '카페' },
            workspace_knowledge_harnesses: { version_no: 1, offerings: [] },
            harness_rules: { version: 1, structured_rule: {} },
          }
          return { data: row[table] ?? null, error: null }
        },
        then: (resolve: (x: unknown) => unknown) => resolve(table === 'marketing_missions'
          ? { count: 0, data: null, error: null }
          : table === 'knowledge_facts' ? { data: admin.facts, count: admin.facts.length, error: null } : { data: [{ channel: 'instagram', status: 'connected', account_label: 'momo' }], error: null }),
        insert: (row: any) => { events.push('persist'); currentMission = row; return chain },
        update: (row: any) => { events.push('persist'); currentMission = { ...currentMission, ...row }; return chain },
        single: async () => ({ data: currentMission, error: null }),
      }
      return chain
    },
  }
  return admin
}

beforeEach(() => {
  compose.mockReset().mockResolvedValue(copies)
  image.mockReset().mockResolvedValue({ assetId: 'image-1' })
})

function existingDraft() {
  return {
    id: missionId, status: 'AWAITING_APPROVAL', created_at: '2026-10-07T00:00:00.000Z', updated_at: '2026-10-07T00:00:00.000Z',
    metadata: { lane: 'QUICK_POST', factSnapshot: resolveApprovedFacts({ workspaceId, at: '2026-10-07T00:00:00Z', rows: [] }), quick: { revision: 1, topic: '커피', businessName: '모모 카페' }, payload: {
      workspaceId, missionId, copies, imageIds: ['image-1'], channels: [], boundVersions: {}, rights: {},
    } },
  }
}

describe('quick-post credit reservations', () => {
  it('rejects image-only revision when facts changed without charging or relabeling old copy', async () => {
    const draft = existingDraft()
    const admin = fakeAdmin(300, draft)
    admin.facts = [{ id: 'new-price', workspace_id: workspaceId, category: 'PRICE', content: '라테 5,000원',
      status: 'active', source_candidate_id: 'candidate', approved_by_user_id: 'owner',
      approved_at: '2026-10-01T00:00:00Z', valid_from: '2026-10-01T00:00:00Z', valid_until: null,
      supersedes_fact_id: null, created_at: '2026-10-01T00:00:00Z' }]
    await expect(reviseQuickDraft({ admin, workspaceId, userId: 'user', missionId, feedback: '사진만 바꿔줘', scope: 'image' }))
      .rejects.toMatchObject({ code: 'FACT_SNAPSHOT_STALE', status: 409 })
    expect(admin.charged).toBe(0)
    expect(admin.events).not.toContain('persist')
    expect(image).not.toHaveBeenCalled()
  })

  it('reserves 250 before generation, settles once after saving the new draft, and returns the charged amount', async () => {
    const admin = fakeAdmin()
    const item = await createQuickDraft({ admin, workspaceId, userId: 'user', topic: '커피', missionId })
    expect(item.creditsCharged).toBe(250)
    expect(admin.available).toBe(50)
    expect(admin.charged).toBe(250)
    expect(admin.events).toEqual(['reserve_quick_post_credits', 'persist', 'settle_quick_post_credits'])
    expect(compose).toHaveBeenCalledTimes(1)
    expect(image).toHaveBeenCalledTimes(1)
  })

  it('first-value path persists text with an explanation after image generation fails', async () => {
    const admin = fakeAdmin()
    image.mockRejectedValueOnce(new Error('provider unavailable'))
    const item = await createQuickDraft({ admin, workspaceId, userId: 'user', topic: '커피', missionId, allowTextOnlyOnImageError: true })
    expect(item.copies.threads.content).toBe('매장 소개')
    expect(item.imageIds).toEqual([])
    expect(item.imageNotice).toContain('글만 먼저')
    expect(admin.events).toEqual(['reserve_quick_post_credits', 'persist', 'settle_quick_post_credits'])
  })

  it('releases all reserved credits when image generation fails', async () => {
    const admin = fakeAdmin()
    image.mockRejectedValueOnce(new Error('provider failed'))
    await expect(createQuickDraft({ admin, workspaceId, userId: 'user', topic: '커피', missionId })).rejects.toThrow('provider failed')
    expect(admin.available).toBe(300)
    expect(admin.charged).toBe(0)
    expect(admin.events).toEqual(['reserve_quick_post_credits', 'release_quick_post_credits'])
  })

  it('rejects insufficient credits with HTTP 402 before calling providers', async () => {
    const admin = fakeAdmin(249)
    const err = await createQuickDraft({ admin, workspaceId, userId: 'user', topic: '커피', missionId }).catch((e) => e)
    expect(err).toBeInstanceOf(QuickPostError)
    expect(err).toMatchObject({ code: 'INSUFFICIENT_CREDITS', status: 402 })
    expect(err.message).toContain('필요 250 / 보유 249')
    expect(compose).not.toHaveBeenCalled()
    expect(image).not.toHaveBeenCalled()
  })

  it('repeated idempotency key does not regenerate or deduct twice', async () => {
    const admin = fakeAdmin()
    const first = await createQuickDraft({ admin, workspaceId, userId: 'user', topic: '커피', missionId })
    const second = await createQuickDraft({ admin, workspaceId, userId: 'user', topic: '커피', missionId })
    expect(second).toEqual(first)
    expect(admin.charged).toBe(250)
    expect(compose).toHaveBeenCalledTimes(1)
    expect(image).toHaveBeenCalledTimes(1)
  })

  it.each([['text', 100], ['image', 150], ['both', 250]] as const)(
    'reserves and settles %s revision for %i SC only', async (scope, amount) => {
      const admin = fakeAdmin(300, existingDraft())
      const item = await reviseQuickDraft({ admin, workspaceId, userId: 'user', missionId, feedback: '수정', scope })
      expect(item.creditsCharged).toBe(amount)
      expect(admin.charged).toBe(amount)
      expect(admin.events).toEqual(['reserve_quick_post_credits', 'persist', 'settle_quick_post_credits'])
    },
  )

  it('restores a persisted draft after an uncertain settlement without generating again', async () => {
    const admin = fakeAdmin()
    const rpc = admin.rpc.bind(admin)
    let firstSettle = true
    admin.rpc = async (name: string, args: Record<string, any>) => {
      if (name === 'settle_quick_post_credits' && firstSettle) {
        firstSettle = false
        return { data: null, error: { message: 'network error' } }
      }
      return rpc(name, args)
    }
    await expect(createQuickDraft({ admin, workspaceId, userId: 'user', topic: '커피', missionId })).rejects.toMatchObject({ code: 'CREDIT_SETTLE_FAILED' })
    const item = await createQuickDraft({ admin, workspaceId, userId: 'user', topic: '커피', missionId })
    expect(item.creditsCharged).toBe(250)
    expect(admin.charged).toBe(250)
    expect(compose).toHaveBeenCalledTimes(1)
    expect(image).toHaveBeenCalledTimes(1)
  })

  it('releases reservation if the draft insert fails', async () => {
    const admin = fakeAdmin()
    const from = admin.from.bind(admin)
    admin.from = (table: string) => {
      const chain = from(table)
      if (table === 'marketing_missions') chain.insert = () => ({
        select: () => ({ single: async () => ({ data: null, error: { message: 'write failed' } }) }),
      })
      return chain
    }
    await expect(createQuickDraft({ admin, workspaceId, userId: 'user', topic: '커피', missionId })).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' })
    expect(admin.available).toBe(300)
    expect(admin.charged).toBe(0)
    expect(admin.events).toEqual(['reserve_quick_post_credits', 'release_quick_post_credits'])
  })

  it('a failed request cannot reuse its released idempotency key or generate a second time', async () => {
    const admin = fakeAdmin()
    image.mockRejectedValueOnce(new Error('provider failed'))
    await expect(createQuickDraft({ admin, workspaceId, userId: 'user', topic: '커피', missionId })).rejects.toThrow('provider failed')
    const err = await createQuickDraft({ admin, workspaceId, userId: 'user', topic: '커피', missionId }).catch((e) => e)
    expect(err).toMatchObject({ code: 'REQUEST_IN_PROGRESS', status: 409 })
    expect(admin.charged).toBe(0)
    expect(compose).toHaveBeenCalledTimes(1)
    expect(image).toHaveBeenCalledTimes(1)
  })

  it('a second revision of the same post is charged independently after its first revision', async () => {
    const admin = fakeAdmin(400, existingDraft())
    const first = await reviseQuickDraft({ admin, workspaceId, userId: 'user', missionId, feedback: '첫 번째', scope: 'text' })
    const second = await reviseQuickDraft({ admin, workspaceId, userId: 'user', missionId, feedback: '두 번째', scope: 'image' })
    expect(first.creditsCharged).toBe(100)
    expect(second.creditsCharged).toBe(150)
    expect(admin.charged).toBe(250)
    expect(admin.available).toBe(150)
    expect(admin.reservations.size).toBe(2)
  })

  it('releases revision credits if the model fails before saving', async () => {
    const admin = fakeAdmin(300, existingDraft())
    compose.mockRejectedValueOnce(new Error('text provider failed'))
    await expect(reviseQuickDraft({ admin, workspaceId, userId: 'user', missionId, feedback: '고쳐줘', scope: 'text' })).rejects.toThrow('text provider failed')
    expect(admin.available).toBe(300)
    expect(admin.charged).toBe(0)
    expect(admin.mission.metadata.quick.revision).toBe(1)
    expect(admin.events).toEqual(['reserve_quick_post_credits', 'release_quick_post_credits'])
  })

  it('manual text edits consume no credits and make no provider calls', async () => {
    const admin = fakeAdmin(0, existingDraft())
    const item = await reviseQuickDraft({ admin, workspaceId, userId: 'user', missionId, feedback: '', scope: 'both', manualCopies: copies })
    expect(item.creditsCharged).toBe(0)
    expect(admin.charged).toBe(0)
    expect(admin.events).toEqual(['persist'])
    expect(compose).not.toHaveBeenCalled()
    expect(image).not.toHaveBeenCalled()
  })

  describe('diagnostic logging, retry, and copy improvements', () => {
    it('retries once and succeeds if first reserve RPC attempt experiences a transient failure', async () => {
      let attempts = 0
      const mockAdmin = {
        rpc: vi.fn(async (name: string) => {
          if (name === 'reserve_quick_post_credits') {
            attempts++
            if (attempts === 1) {
              return { data: null, error: { message: 'lock timeout', code: '55P03' } }
            }
            return {
              data: { reservationId: 'res-retry-1', state: 'reserved', requestedCredits: 250, isReplay: false },
              error: null,
            }
          }
          return { data: null, error: null }
        }),
      }

      const res = await reserveQuickPostCredits({
        admin: mockAdmin as any,
        workspaceId,
        missionId,
        revision: 1,
        scope: 'both',
      })
      expect(res.reservationId).toBe('res-retry-1')
      expect(res.state).toBe('reserved')
      expect(mockAdmin.rpc).toHaveBeenCalledTimes(2)
    })

    it('logs error via console.error and throws friendly failure if reserve RPC fails repeatedly', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mockAdmin = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'QUICK_POST_CREDIT_STATE_MISSING', code: 'P0001' },
        }),
      }

      const err = await reserveQuickPostCredits({
        admin: mockAdmin as any,
        workspaceId,
        missionId,
        revision: 1,
        scope: 'both',
      }).catch((e) => e)

      expect(err).toBeInstanceOf(QuickPostCreditFailure)
      expect(err.code).toBe('CREDIT_RESERVE_FAILED')
      expect(err.status).toBe(503)
      expect(err.message).toBe('크레딧 확인 중 일시적인 연결 지연이 발생했어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.')
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[quick-post-credits] reserve_quick_post_credits RPC error:',
        expect.objectContaining({
          workspaceId,
          missionId,
          revision: 1,
          scope: 'both',
          code: 'P0001',
          message: 'QUICK_POST_CREDIT_STATE_MISSING',
        }),
      )
      consoleErrorSpy.mockRestore()
    })

    it('settleQuickPostCredits records the settled generation cost only after the RPC confirmed (ANI-1602)', async () => {
      const upsert = vi.fn().mockResolvedValue({ error: null })
      const reservation = { reservationId: 'res-1', state: 'reserved' as const, requestedCredits: 250, operationKey: 'quick-post:m:1:both', isReplay: false }
      const ok = { rpc: vi.fn().mockResolvedValue({ data: { reservationId: 'res-1', state: 'settled' }, error: null }), from: vi.fn(() => ({ upsert })) }
      await settleQuickPostCredits(ok as any, workspaceId, reservation)
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({ workspace_id: workspaceId, event: 'generation_cost_settled', dedupe_key: 'generation_cost_settled:res-1' }),
        expect.anything(),
      )
      const upsertFailed = vi.fn()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const bad = { rpc: vi.fn().mockResolvedValue({ data: { reservationId: 'res-1', state: 'reserved' }, error: null }), from: vi.fn(() => ({ upsert: upsertFailed })) }
      await expect(settleQuickPostCredits(bad as any, workspaceId, reservation)).rejects.toBeInstanceOf(QuickPostCreditFailure)
      expect(upsertFailed).not.toHaveBeenCalled()
    })

    it('settleQuickPostCredits logs error via console.error on RPC error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mockAdmin = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'settle connection lost', code: '08006' },
        }),
      }

      const err = await settleQuickPostCredits(mockAdmin as any, workspaceId, {
        reservationId: 'res-1',
        state: 'reserved',
        requestedCredits: 250,
        operationKey: 'quick-post:m:1:both',
        isReplay: false,
      }).catch((e) => e)

      expect(err).toBeInstanceOf(QuickPostCreditFailure)
      expect(err.code).toBe('CREDIT_SETTLE_FAILED')
      expect(err.status).toBe(503)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[quick-post-credits] settle_quick_post_credits RPC error:',
        expect.objectContaining({
          workspaceId,
          reservationId: 'res-1',
          code: '08006',
          message: 'settle connection lost',
        }),
      )
      consoleErrorSpy.mockRestore()
    })

    it('releaseQuickPostCredits logs error via console.error on RPC error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mockAdmin = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'release connection lost', code: '08006' },
        }),
      }

      const err = await releaseQuickPostCredits(mockAdmin as any, workspaceId, {
        reservationId: 'res-1',
        state: 'reserved',
        requestedCredits: 250,
        operationKey: 'quick-post:m:1:both',
        isReplay: false,
      }).catch((e) => e)

      expect(err).toBeInstanceOf(QuickPostCreditFailure)
      expect(err.code).toBe('CREDIT_RELEASE_FAILED')
      expect(err.status).toBe(503)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[quick-post-credits] release_quick_post_credits RPC error:',
        expect.objectContaining({
          workspaceId,
          reservationId: 'res-1',
          code: '08006',
          message: 'release connection lost',
        }),
      )
      consoleErrorSpy.mockRestore()
    })
  })

  describe('self-heal signup starter credits on insufficient balance', () => {
    it('calls ensure_signup_starter_credits and succeeds on retry when 1+ SNS is connected and no prior grant exists', async () => {
      let rpcCallCount = 0
      const mockAdmin: any = {
        rpc: vi.fn(async (name: string) => {
          if (name === 'reserve_quick_post_credits') {
            rpcCallCount++
            if (rpcCallCount === 1) {
              return { data: { state: 'insufficient', availableCredits: 0 }, error: null }
            }
            return {
              data: { reservationId: 'res-healed-1', state: 'reserved', requestedCredits: 250, isReplay: false },
              error: null,
            }
          }
          if (name === 'ensure_signup_starter_credits') {
            return { data: { granted: true, credits_granted: 600 }, error: null }
          }
          return { data: null, error: null }
        }),
        from: vi.fn((table: string) => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => {
              if (table === 'channel_connections') {
                return {
                  data: [{ channel: 'instagram', status: 'connected' }],
                  error: null,
                }
              }
              if (table === 'credit_ledger_entries') {
                return {
                  eq: vi.fn(() => ({
                    data: [], // 아직 지급 이력 없음
                    error: null,
                  })),
                }
              }
              if (table === 'workspaces') {
                return {
                  maybeSingle: async () => ({ data: { created_by: 'owner-uuid' }, error: null }),
                }
              }
              return { data: [], error: null }
            }),
          })),
        })),
      }

      const res = await reserveQuickPostCredits({
        admin: mockAdmin,
        workspaceId,
        missionId,
        revision: 1,
        scope: 'both',
        userId: 'user-1',
      })

      expect(res.reservationId).toBe('res-healed-1')
      expect(res.state).toBe('reserved')
      expect(mockAdmin.rpc).toHaveBeenCalledWith('ensure_signup_starter_credits', {
        p_user_id: 'user-1',
        p_workspace_id: workspaceId,
      })
      expect(rpcCallCount).toBe(2)
    })

    it('retries only once and throws INSUFFICIENT_CREDITS if self-heal fails or credits remain insufficient', async () => {
      let rpcCallCount = 0
      const mockAdmin: any = {
        rpc: vi.fn(async (name: string) => {
          if (name === 'reserve_quick_post_credits') {
            rpcCallCount++
            return { data: { state: 'insufficient', availableCredits: 0 }, error: null }
          }
          if (name === 'ensure_signup_starter_credits') {
            return { data: { granted: false }, error: null }
          }
          return { data: null, error: null }
        }),
        from: vi.fn((table: string) => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => {
              if (table === 'channel_connections') {
                return { data: [{ channel: 'threads', status: 'connected' }], error: null }
              }
              if (table === 'credit_ledger_entries') {
                return { eq: vi.fn(() => ({ data: [], error: null })) }
              }
              return { maybeSingle: async () => ({ data: { created_by: 'owner-uuid' }, error: null }) }
            }),
          })),
        })),
      }

      const err = await reserveQuickPostCredits({
        admin: mockAdmin,
        workspaceId,
        missionId,
        revision: 1,
        scope: 'both',
        userId: 'user-1',
      }).catch((e) => e)

      expect(err).toBeInstanceOf(QuickPostCreditFailure)
      expect(err.code).toBe('INSUFFICIENT_CREDITS')
      expect(err.status).toBe(402)
      // 정확히 2번 호출 (초기 1회 + self-heal 후 1회) 후 중단 (무한 루프 방지)
      expect(rpcCallCount).toBe(2)
    })

    it('does not attempt self-heal if signup grant history already exists', async () => {
      let rpcCallCount = 0
      const mockAdmin: any = {
        rpc: vi.fn(async (name: string) => {
          if (name === 'reserve_quick_post_credits') {
            rpcCallCount++
            return { data: { state: 'insufficient', availableCredits: 0 }, error: null }
          }
          return { data: null, error: null }
        }),
        from: vi.fn((table: string) => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => {
              if (table === 'channel_connections') {
                return { data: [{ channel: 'instagram', status: 'connected' }], error: null }
              }
              if (table === 'credit_ledger_entries') {
                return {
                  eq: vi.fn(() => ({
                    data: [{ id: 'grant-1', idempotency_key: 'signup-first-post:user-1' }],
                    error: null,
                  })),
                }
              }
              return { maybeSingle: async () => ({ data: { created_by: 'owner-uuid' }, error: null }) }
            }),
          })),
        })),
      }

      const err = await reserveQuickPostCredits({
        admin: mockAdmin,
        workspaceId,
        missionId,
        revision: 1,
        scope: 'both',
        userId: 'user-1',
      }).catch((e) => e)

      expect(err).toBeInstanceOf(QuickPostCreditFailure)
      expect(err.code).toBe('INSUFFICIENT_CREDITS')
      expect(mockAdmin.rpc).not.toHaveBeenCalledWith('ensure_signup_starter_credits', expect.anything())
      expect(rpcCallCount).toBe(1)
    })
  })
})
