import { describe, expect, it } from 'vitest'
import type { VaultItem } from '../../types'
import { FakeVaultQueryRepository, VaultQueryService } from '../vault-query-service'

describe('VaultQueryService (보관함 조회 서비스 통합 단위 테스트)', () => {
  const ws1 = '11111111-1111-1111-1111-111111111111'
  const ws2 = '22222222-2222-2222-2222-222222222222'

  const makeItem = (overrides: Partial<VaultItem>): VaultItem => ({
    id: 'item-uuid-1',
    workspaceId: ws1,
    contentId: 'content-uuid-1',
    versionId: 'version-uuid-1',
    channel: 'instagram',
    releaseGate: 'HELD_PROVIDER_PENDING',
    holdReason: 'META_REVIEW_PENDING',
    heldAt: '2026-10-07T00:00:00.000Z',
    heldBy: null,
    targetDate: '2026-10-07',
    approvedFingerprint: 'a'.repeat(64),
    fingerprintSchemaVersion: 1,
    policyVersion: 'v1.0.0',
    specVersion: 'v1.0.0',
    approvalState: 'APPROVED',
    approvedBy: null,
    bundleId: null,
    idempotencyKey: 'idemp-1',
    deletedAt: null,
    createdAt: '2026-10-07T00:00:00.000Z',
    updatedAt: '2026-10-07T00:00:00.000Z',
    ...overrides,
  })

  describe('1. 요약 KPI 및 외부 게시 COUNT 실제 집계 검증', () => {
    it('보관 행에 연결된 external_action이 0건이면 warning이 null이고 count는 0이다', async () => {
      const repo = new FakeVaultQueryRepository()
      repo.seedVaultItems([
        makeItem({ id: 'i1', versionId: 'v1', approvalState: 'APPROVED' }),
        makeItem({ id: 'i2', versionId: 'v2', approvalState: 'NEEDS_REAPPROVAL' }),
      ])

      const service = new VaultQueryService(repo)
      const summary = await service.getSummary(ws1)

      expect(summary.stored_count).toBe(1)
      expect(summary.needs_reapproval_count).toBe(1)
      expect(summary.external_action_count).toBe(0)
      expect(summary.external_action_warning).toBeNull()
      expect(typeof summary.this_week_count).toBe('number')
    })

    it('수락 기준: 보관 행에 external_action을 연결하면 실제 집계되어 external_action_warning 경고가 발생한다', async () => {
      const repo = new FakeVaultQueryRepository()
      repo.seedVaultItems([
        makeItem({ id: 'i1', versionId: 'v1', approvalState: 'APPROVED' }),
        makeItem({ id: 'i2', versionId: 'v2', approvalState: 'APPROVED' }),
      ])
      // v1에 연결된 외부 게시 요청 1건 추가
      repo.seedExternalActionRequests([
        { id: 'ear-1', workspaceId: ws1, contentVersionId: 'v1' },
      ])

      const service = new VaultQueryService(repo)
      const summary = await service.getSummary(ws1)

      expect(summary.external_action_count).toBe(1)
      expect(summary.external_action_warning).not.toBeNull()
      expect(summary.external_action_warning).toContain('1건')
      expect(summary.external_action_warning).toContain('외부 게시')
    })

    it('동일 버전의 타 채널 외부 게시 요청은 보관 항목 위반으로 오탐하지 않는다', async () => {
      const repo = new FakeVaultQueryRepository()
      repo.seedVaultItems([
        makeItem({ id: 'i1', versionId: 'v1', channel: 'threads', approvalState: 'APPROVED' }),
      ])
      // 동일한 v1이지만 채널이 instagram인 게시 요청이 존재하는 경우 (threads 보관 항목 위반 아님)
      repo.seedExternalActionRequests([
        { id: 'ear-1', workspaceId: ws1, contentVersionId: 'v1', channel: 'instagram' },
      ])

      const service = new VaultQueryService(repo)
      const summary = await service.getSummary(ws1)

      expect(summary.external_action_count).toBe(0)
      expect(summary.external_action_warning).toBeNull()
    })

    it('SupabaseVaultQueryRepository는 100개 단위 청크 분할 및 채널 매칭으로 외부 액션을 안전하게 조회한다', async () => {
      const calls: Array<{ inArgs: string[]; selectArgs: string }> = []
      const fakeSupabase = {
        from: (table: string) => {
          expect(table).toBe('external_action_requests')
          const q: any = {
            select: (cols: string) => {
              q._cols = cols
              return q
            },
            eq: () => q,
            in: (_col: string, arr: string[]) => {
              calls.push({ inArgs: arr, selectArgs: q._cols })
              // chunk 1: 100 items, contains v-0 matching instagram
              // chunk 2: 50 items
              const data = arr.map((id) => ({
                id: `ea-${id}`,
                content_version_id: id,
                channel: id === 'v-0' ? 'instagram' : 'threads', // v-0 matches instagram
              }))
              return Promise.resolve({ data, error: null })
            },
          }
          return q
        },
      }

      const { SupabaseVaultQueryRepository } = await import('../vault-query-service')
      const repo = new SupabaseVaultQueryRepository(fakeSupabase)
      const targets = Array.from({ length: 150 }, (_, i) => ({
        versionId: `v-${i}`,
        channel: 'instagram' as const,
      }))

      const count = await repo.countExternalActionRequestsForVersions(ws1, targets)

      // 150개 항목이 100개, 50개 2개 청크로 분할되어 호출됨
      expect(calls.length).toBe(2)
      expect(calls[0].inArgs.length).toBe(100)
      expect(calls[1].inArgs.length).toBe(50)
      // v-0만 instagram 채널과 일치하므로 카운트는 1
      expect(count).toBe(1)
    })
  })

  describe('2. 타 workspace 데이터 0건 격리 검증 (Cross-Tenant Isolation)', () => {
    it('ws1으로 조회 시 ws2에 속한 아이템은 0건이어야 한다', async () => {
      const repo = new FakeVaultQueryRepository()
      repo.seedVaultItems([
        makeItem({ id: 'item-ws1', workspaceId: ws1 }),
        makeItem({ id: 'item-ws2', workspaceId: ws2 }),
      ])
      repo.seedExternalActionRequests([
        { id: 'ear-ws2', workspaceId: ws2, contentVersionId: 'version-uuid-1' },
      ])

      const service = new VaultQueryService(repo)

      // ws1 목록 조회
      const ws1List = await service.listItems(ws1, { period: 'all' })
      expect(ws1List.items.length).toBe(1)

      // ws1 요약 조회 (ws2의 external_action은 영향 없어야 함)
      const ws1Summary = await service.getSummary(ws1)
      expect(ws1Summary.total_count).toBe(1)
      expect(ws1Summary.external_action_count).toBe(0)
      expect(ws1Summary.external_action_warning).toBeNull()
    })
  })

  describe('3. 목록 조회 필터 및 커서 페이지네이션 검증', () => {
    it('채널 및 상태 필터가 올바르게 작동한다', async () => {
      const repo = new FakeVaultQueryRepository()
      repo.seedVaultItems([
        makeItem({ id: 'i1', channel: 'instagram', approvalState: 'APPROVED' }),
        makeItem({ id: 'i2', channel: 'threads', approvalState: 'APPROVED' }),
        makeItem({ id: 'i3', channel: 'instagram', approvalState: 'NEEDS_REAPPROVAL' }),
        makeItem({ id: 'i4', channel: 'instagram', approvalState: 'INVALIDATED' }),
      ])

      const service = new VaultQueryService(repo)

      // instagram + held
      const filtered = await service.listItems(ws1, {
        channel: 'instagram',
        status: 'held',
      })
      expect(filtered.items.length).toBe(1)

      // needs_reapproval 필터
      const needs = await service.listItems(ws1, {
        status: 'needs_reapproval',
      })
      expect(needs.items.length).toBe(1)
    })

    it('unscheduled 필터는 target_date가 null인 항목만 반환한다', async () => {
      const repo = new FakeVaultQueryRepository()
      repo.seedVaultItems([
        makeItem({ id: 'i1', targetDate: '2026-10-07' }),
        makeItem({ id: 'i2', targetDate: null }),
      ])

      const service = new VaultQueryService(repo)
      const res = await service.listItems(ws1, { period: 'unscheduled' })
      expect(res.items.length).toBe(1)
      expect(res.items[0].target_date).toBeNull()
    })

    it('커서 페이지네이션: limit 개수만큼 반환하고 nextCursor 및 hasMore를 올바르게 계산한다', async () => {
      const repo = new FakeVaultQueryRepository()
      repo.seedVaultItems([
        makeItem({ id: 'i1', createdAt: '2026-10-01T00:00:00.000Z', targetDate: '2026-10-01' }),
        makeItem({ id: 'i2', createdAt: '2026-10-02T00:00:00.000Z', targetDate: '2026-10-02' }),
        makeItem({ id: 'i3', createdAt: '2026-10-03T00:00:00.000Z', targetDate: '2026-10-03' }),
      ])

      const service = new VaultQueryService(repo)
      // limit: 2
      const firstPage = await service.listItems(ws1, { limit: 2, sort: 'target_date', order: 'asc' })
      expect(firstPage.items.length).toBe(2)
      expect(firstPage.hasMore).toBe(true)
      expect(firstPage.nextCursor).not.toBeNull()

      // 2페이지 조회
      const secondPage = await service.listItems(ws1, {
        limit: 2,
        sort: 'target_date',
        order: 'asc',
        cursor: firstPage.nextCursor!,
      })
      expect(secondPage.items.length).toBe(1)
      expect(secondPage.hasMore).toBe(false)
      expect(secondPage.nextCursor).toBeNull()
    })
  })

  describe('4. 달력 집계 검증', () => {
    it('월 단위 일자별 건수와 채널 분포를 올바르게 집계한다', async () => {
      const repo = new FakeVaultQueryRepository()
      repo.seedVaultItems([
        makeItem({ id: 'i1', targetDate: '2026-10-07', channel: 'instagram' }),
        makeItem({ id: 'i2', targetDate: '2026-10-07', channel: 'threads' }),
        makeItem({ id: 'i3', targetDate: '2026-10-08', channel: 'instagram' }),
        makeItem({ id: 'i4', targetDate: null, channel: 'naver_blog' }), // 미정
        makeItem({ id: 'i5', targetDate: '2026-11-01', channel: 'instagram' }), // 다른 달
      ])

      const service = new VaultQueryService(repo)
      const calendar = await service.getCalendar(ws1, '2026-10')

      expect(calendar.ym).toBe('2026-10')
      expect(calendar.unscheduled_count).toBe(1)
      expect(calendar.days['2026-10-07']).toEqual({
        total: 2,
        channels: { instagram: 1, threads: 1 },
      })
      expect(calendar.days['2026-10-08']).toEqual({
        total: 1,
        channels: { instagram: 1 },
      })
      expect(calendar.days['2026-11-01']).toBeUndefined()
    })
  })

  describe('5. ERROR vs EMPTY 구분 검증', () => {
    it('데이터가 0건일 때(EMPTY)는 에러가 아니라 빈 목록을 반환한다', async () => {
      const repo = new FakeVaultQueryRepository()
      const service = new VaultQueryService(repo)

      const result = await service.listItems(ws1, { period: 'all' })
      expect(result.items).toEqual([])
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
    })

    it('저장소 조회 실패(ERROR) 시 빈 목록으로 덮지 않고 예외를 던진다 (Fail-Closed)', async () => {
      const repo = new FakeVaultQueryRepository()
      repo.simulateFailure = true
      const service = new VaultQueryService(repo)

      await expect(service.listItems(ws1, { period: 'all' })).rejects.toThrow('Database query failed')
      await expect(service.getSummary(ws1)).rejects.toThrow('Database query failed')
      await expect(service.getCalendar(ws1, '2026-10')).rejects.toThrow('Database query failed')
    })
  })
})
