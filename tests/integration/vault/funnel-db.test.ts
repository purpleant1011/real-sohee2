import { beforeAll, describe, expect, it } from 'vitest'
import {
  calculateVaultFunnelMetrics,
  queryVaultFunnel,
  recordVaultFunnelEvent,
  validateVaultFunnelPayload,
  VaultFunnelPayloadError,
} from '@/features/vault/funnel'
import { pgClient, query } from './pg-client'

describe('ANI-1567 Vault Funnel Database & Real Postgres Integration', () => {
  const ws = 'a5555555-5555-4555-8555-555555555555'
  const user = 'a6666666-6666-4666-8666-666666666666'

  beforeAll(() => {
    query(
      `with users as (insert into auth.users (id) values ('${user}') on conflict do nothing returning id) select id from users`,
    )
    query(
      `with workspaces as (insert into public.workspaces (id, name, created_by) values ('${ws}', '보관함 퍼널 테스트', '${user}') on conflict do nothing returning id) select id from workspaces`,
    )
  })

  it('guarantees idempotency: exact 1 record per user action even with retries', async () => {
    const admin = pgClient()
    const dedupeKey = `preview_opened:instagram:content-100:v1`

    // Attempt recording twice
    const res1 = await recordVaultFunnelEvent(
      {
        workspaceId: ws,
        userId: user,
        event: 'preview_opened',
        channel: 'instagram',
        properties: {
          contentId: '11111111-1111-4111-8111-111111111111',
          versionId: '22222222-2222-4222-8222-222222222222',
        },
        dedupeKey,
      },
      { admin: admin as any },
    )
    expect(res1.success).toBe(true)

    const res2 = await recordVaultFunnelEvent(
      {
        workspaceId: ws,
        userId: user,
        event: 'preview_opened',
        channel: 'instagram',
        properties: {
          contentId: '11111111-1111-4111-8111-111111111111',
          versionId: '22222222-2222-4222-8222-222222222222',
        },
        dedupeKey,
      },
      { admin: admin as any },
    )
    expect(res2.success).toBe(true)

    // Check actual database count
    const rows = query<any>(
      `select count(*)::int as count from public.funnel_events where workspace_id = '${ws}' and event = 'preview_opened' and dedupe_key = '${dedupeKey}'`,
    )
    expect(rows[0].count).toBe(1)
  })

  it('proves privacy safety: payload schema strictly forbids post body, titles and captions', () => {
    const forbiddenAttempts = [
      { channel: 'instagram', title: '여름 할인 이벤트' },
      { channel: 'instagram', text: '오픈 기념 특별 혜택을 확인하세요' },
      { channel: 'instagram', caption: '캡션 내용' },
      { channel: 'threads', body: '스레드 본문' },
      { channel: 'naver_blog', rawText: '블로그 원문' },
      { channel: 'daangn_business', hashtags: ['#세일', '#할인'] },
    ]

    for (const attempt of forbiddenAttempts) {
      expect(() => validateVaultFunnelPayload(attempt)).toThrowError(
        VaultFunnelPayloadError,
      )
    }
  })

  it('computes exact funnel conversion matching real database records', async () => {
    const admin = pgClient()
    const contentId = '33333333-3333-4333-8333-333333333333'
    const versionId = '44444444-4444-4444-8444-444444444444'

    // Clean any prior events for this content test using CTE
    query(
      `with deleted as (delete from public.funnel_events where workspace_id = '${ws}' returning *) select json_build_object('data', count(*)) as data from deleted`,
    )

    // Seed events for 'threads' channel:
    // 4 preview_opened
    // 2 vault_saved (50% conversion)
    // 1 vault_edited (50% conversion)
    // 1 reapproved (100% conversion)
    // 1 release_requested (50% of saved)
    // 1 publish_verified (100% of requested)
    for (let i = 1; i <= 4; i++) {
      const res = await recordVaultFunnelEvent(
        {
          workspaceId: ws,
          userId: user,
          event: 'preview_opened',
          channel: 'threads',
          properties: { contentId, versionId },
          dedupeKey: `prev:th:${i}`,
        },
        { admin: admin as any },
      )
      expect(res.success).toBe(true)
    }

    for (let i = 1; i <= 2; i++) {
      const res = await recordVaultFunnelEvent(
        {
          workspaceId: ws,
          userId: user,
          event: 'vault_saved',
          channel: 'threads',
          properties: { contentId, versionId, idempotencyKey: `save-k-${i}` },
          dedupeKey: `save:th:${i}`,
        },
        { admin: admin as any },
      )
      expect(res.success).toBe(true)
    }

    await recordVaultFunnelEvent(
      {
        workspaceId: ws,
        userId: user,
        event: 'vault_edited',
        channel: 'threads',
        properties: { contentId, versionId },
        dedupeKey: `edit:th:1`,
      },
      { admin: admin as any },
    )

    await recordVaultFunnelEvent(
      {
        workspaceId: ws,
        userId: user,
        event: 'reapproved',
        channel: 'threads',
        properties: { contentId, versionId, fingerprint: 'f'.repeat(64) },
        dedupeKey: `reapp:th:1`,
      },
      { admin: admin as any },
    )

    await recordVaultFunnelEvent(
      {
        workspaceId: ws,
        userId: user,
        event: 'release_requested',
        channel: 'threads',
        properties: { contentId, versionId },
        dedupeKey: `rel:th:1`,
      },
      { admin: admin as any },
    )

    await recordVaultFunnelEvent(
      {
        workspaceId: ws,
        userId: user,
        event: 'publish_verified',
        channel: 'threads',
        properties: { contentId, versionId },
        dedupeKey: `pub:th:1`,
      },
      { admin: admin as any },
    )

    const readModel = await queryVaultFunnel(
      { admin: admin as any },
      {
        workspaceId: ws,
        period: {
          from: new Date(Date.now() - 3600_000).toISOString(),
          to: new Date(Date.now() + 3600_000).toISOString(),
        },
        channel: 'threads',
      },
    )

    expect(readModel.status).toBe('OK')
    expect(readModel.totalEvents).toBe(10)

    const [prev, saved, edited, reapp, req, ver] = readModel.stages
    expect(prev.count).toBe(4)
    expect(prev.conversionRate).toBe(100.0)

    expect(saved.count).toBe(2)
    expect(saved.previousStageCount).toBe(4)
    expect(saved.conversionRate).toBe(50.0)

    expect(edited.count).toBe(1)
    expect(edited.previousStageCount).toBe(2)
    expect(edited.conversionRate).toBe(50.0)

    expect(reapp.count).toBe(1)
    expect(reapp.previousStageCount).toBe(1)
    expect(reapp.conversionRate).toBe(100.0)

    expect(req.count).toBe(1)
    expect(req.previousStageCount).toBe(2)
    expect(req.conversionRate).toBe(50.0)

    expect(ver.count).toBe(1)
    expect(ver.previousStageCount).toBe(1)
    expect(ver.conversionRate).toBe(100.0)

    // Overall: 1 / 4 = 25.0%
    expect(readModel.overallConversionRate).toBe(25.0)
  })

  it('marks missing stages as NOT_VERIFIED and null conversion rate rather than fake 0%', () => {
    // Only release_requested exists without any vault_saved
    const rows = [
      {
        id: '1',
        workspace_id: ws,
        user_id: user,
        event: 'release_requested',
        occurred_at: '2026-10-07T00:00:00Z',
        properties: { channel: 'instagram' },
        dedupe_key: 'rel-isolated',
      },
    ]

    const model = calculateVaultFunnelMetrics({
      workspaceId: ws,
      period: { from: '2026-10-01T00:00:00Z', to: '2026-10-07T23:59:59Z' },
      channel: 'instagram',
      rows,
    })

    const reqStage = model.stages.find((s) => s.event === 'release_requested')!
    expect(reqStage.count).toBe(1)
    expect(reqStage.previousStageCount).toBe(0)
    expect(reqStage.conversionRate).toBeNull()
    expect(reqStage.status).toBe('NOT_VERIFIED')
  })

  it('distinguishes EMPTY from ERROR', async () => {
    const admin = pgClient()

    // 1. Period with no events -> EMPTY
    const emptyModel = await queryVaultFunnel(
      { admin: admin as any },
      {
        workspaceId: ws,
        period: {
          from: '2020-01-01T00:00:00Z',
          to: '2020-01-02T00:00:00Z',
        },
        channel: 'ALL',
      },
    )
    expect(emptyModel.status).toBe('EMPTY')
    expect(emptyModel.totalEvents).toBe(0)
    expect(emptyModel.error).toBeUndefined()

    // 2. Erroneous query -> ERROR
    const badAdmin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            gte: () => ({
              lte: () => ({
                in: () =>
                  Promise.resolve({
                    data: null,
                    error: { message: 'Database connection failed' },
                  }),
              }),
            }),
          }),
        }),
      }),
    }
    const errorModel = await queryVaultFunnel(
      { admin: badAdmin as any },
      {
        workspaceId: ws,
        period: { from: '2026-10-01T00:00:00Z', to: '2026-10-07T23:59:59Z' },
        channel: 'ALL',
      },
    )
    expect(errorModel.status).toBe('ERROR')
    expect(errorModel.error).toBe('보관함을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
  })
})
