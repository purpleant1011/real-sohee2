import { describe, expect, it } from 'vitest'
import { createQuickDraft, QUICK_POST_DAILY_LIMIT, QUICK_POST_MAX_TOTAL_REVISIONS, QuickPostError, reviseQuickDraft } from '../quick-post-service'

function adminWith(tables: Record<string, any>, rpcMocks: Record<string, any> = {}) {
  return {
    rpc(name: string, args: any) {
      if (rpcMocks[name]) return rpcMocks[name](args)
      return { data: null, error: null }
    },
    from(table: string) {
      const t = tables[table]
      let isDaily = false
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        gte: () => { isDaily = true; return chain },
        in: () => chain,
        not: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: t?.single ?? null, error: null }),
        insert: async (row: any) => ({ data: { id: row?.id, ...row }, error: null }),
        then: (resolve: any) => {
          const target = (isDaily && t?.daily) ? t.daily : (!isDaily && t?.trial) ? t.trial : t
          if (target && 'count' in target) {
            return resolve({ data: target.list ?? null, count: target.count, error: target.error ?? null })
          }
          if (target?.list) {
            return resolve({ data: target.list, count: target.count ?? target.list.length, error: null })
          }
          return resolve({ count: target?.count ?? 0, data: null, error: null })
        },
      }
      return chain
    },
  }
}

const readyTables = {
  knowledge_facts: { list: [] },
  business_profiles: { single: { business_name: '모모 카페', industry: '카페', location: '', summary: 's' } },
  workspace_knowledge_harnesses: { single: { version_no: 1, offerings: [] } },
  harness_rules: { single: { version: 1, structured_rule: { brandVoice: 'x' } } },
  channel_connections: { list: [{ channel: 'instagram', status: 'connected', account_label: 'momo' }] },
  marketing_missions: { count: QUICK_POST_DAILY_LIMIT, single: { id: 'm', status: 'AWAITING_APPROVAL', metadata: { quick: { revision: 6 }, payload: {} } } },
}

describe('quick-post cost guard', () => {
  it('blocks drafts beyond the daily limit before any model call', async () => {
    const err = await createQuickDraft({ admin: adminWith({ ...readyTables, marketing_missions: { count: QUICK_POST_DAILY_LIMIT } }), workspaceId: 'w', userId: 'u', topic: 't' }).catch((e) => e)
    expect(err).toBeInstanceOf(QuickPostError)
    expect(err.code).toBe('DAILY_LIMIT_REACHED')
    expect(err.status).toBe(429)
  })

  it('blocks manual edits after the total revision cap before generating or updating', async () => {
    const tables = { ...readyTables, marketing_missions: {
      ...readyTables.marketing_missions,
      single: { ...readyTables.marketing_missions.single, metadata: { ...readyTables.marketing_missions.single.metadata, quick: { revision: QUICK_POST_MAX_TOTAL_REVISIONS + 1 } } },
    } }
    const err = await reviseQuickDraft({ admin: adminWith(tables), workspaceId: 'w', userId: 'u', missionId: 'm', feedback: '', scope: 'text', manualCopies: { instagram: { caption: '카피' }, threads: { content: '글' } } }).catch((e) => e)
    expect(err).toBeInstanceOf(QuickPostError)
    expect(err.code).toBe('TOTAL_REVISION_LIMIT_REACHED')
    expect(err.status).toBe(429)
  })

  it('blocks more than five model revisions per post but still allows manual edits path to proceed past the guard', async () => {
    const err = await reviseQuickDraft({ admin: adminWith(readyTables), workspaceId: 'w', userId: 'u', missionId: 'm', feedback: 'x', scope: 'text' }).catch((e) => e)
    expect(err.code).toBe('REVISION_LIMIT_REACHED')
  })

  it('blocks unverified member with no connected channels after reaching lifetime 2 missions with HTTP 403', async () => {
    const trialTables = {
      ...readyTables,
      channel_connections: { list: [] },
      marketing_missions: { count: 2, single: null },
    }
    const admin = adminWith(trialTables, {
      get_workspace_membership_tier: () => ({ data: 'TRIAL', error: null }),
    })

    const err = await createQuickDraft({ admin, workspaceId: 'w', userId: 'u', topic: '첫 포스팅' }).catch((e) => e)
    expect(err).toBeInstanceOf(QuickPostError)
    expect(err.code).toBe('TRIAL_FIRST_POST_LIMIT_REACHED')
    expect(err.status).toBe(403)
    expect(err.message).toBe('첫 포스팅 2건을 모두 사용했어요. 사업자 인증이 승인되면 계속 쓸 수 있어요.')
  })

  it('allows member with connected SNS channel past trial limit (treated as formal member)', async () => {
    const connectedTables = {
      ...readyTables,
      channel_connections: { list: [{ channel: 'instagram', status: 'connected', account_label: 'momo' }] },
      marketing_missions: { count: 2, single: null },
      credit_accounts: { single: { id: 'acc-1' } },
      quick_post_credit_reservations: { single: null },
    }
    const admin = adminWith(connectedTables, {
      get_workspace_membership_tier: () => ({ data: 'TRIAL', error: null }),
      reserve_quick_post_credits: () => ({ data: { state: 'insufficient', availableCredits: 0 }, error: null }),
    })

    const err = await createQuickDraft({ admin, workspaceId: 'w', userId: 'u', topic: '첫 포스팅' }).catch((e) => e)
    // Passes trial check even though DB tier is TRIAL, because channel is connected!
    expect(err?.code).not.toBe('TRIAL_FIRST_POST_LIMIT_REACHED')
  })

  it('allows formal member (tier === FORMAL) past trial limit', async () => {
    const formalTables = {
      ...readyTables,
      marketing_missions: { count: 2, single: null },
      credit_accounts: { single: { id: 'acc-1' } },
      quick_post_credit_reservations: { single: null },
    }
    const admin = adminWith(formalTables, {
      get_workspace_membership_tier: () => ({ data: 'FORMAL', error: null }),
      reserve_quick_post_credits: () => ({ data: { state: 'insufficient', availableCredits: 0 }, error: null }),
    })

    const err = await createQuickDraft({ admin, workspaceId: 'w', userId: 'u', topic: '첫 포스팅' }).catch((e) => e)
    // Passes trial check; reaches credit reservation or later step instead of TRIAL_FIRST_POST_LIMIT_REACHED
    expect(err?.code).not.toBe('TRIAL_FIRST_POST_LIMIT_REACHED')
  })

  it('fails closed with QUOTA_CHECK_FAILED when daily quota count is null or invalid', async () => {
    for (const invalidCount of [null, undefined, -1, 1.5, NaN, '0']) {
      const err = await createQuickDraft({
        admin: adminWith({
          ...readyTables,
          marketing_missions: { count: invalidCount as any, single: null },
        }),
        workspaceId: 'w',
        userId: 'u',
        topic: 't',
      }).catch((e) => e)
      expect(err).toBeInstanceOf(QuickPostError)
      expect(err.code).toBe('QUOTA_CHECK_FAILED')
      expect(err.status).toBe(503)
      expect(err.message).toBe('사용량을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.')
    }
  })

  it('fails closed with QUOTA_CHECK_FAILED when trial quota count is null or invalid', async () => {
    for (const invalidCount of [null, undefined, -1, 1.5, NaN, '0']) {
      const admin = adminWith(
        {
          ...readyTables,
          channel_connections: { list: [] },
          marketing_missions: {
            daily: { count: 0 },
            trial: { count: invalidCount as any, single: null },
          },
        },
        {
          get_workspace_membership_tier: () => ({ data: 'TRIAL', error: null }),
        },
      )
      const err = await createQuickDraft({ admin, workspaceId: 'w', userId: 'u', topic: '첫 포스팅' }).catch((e) => e)
      expect(err).toBeInstanceOf(QuickPostError)
      expect(err.code).toBe('QUOTA_CHECK_FAILED')
      expect(err.status).toBe(503)
      expect(err.message).toBe('사용량을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.')
    }
  })
})
