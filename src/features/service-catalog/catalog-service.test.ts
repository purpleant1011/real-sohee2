import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  CatalogConflictError,
  CatalogForbiddenError,
  CatalogInvalidError,
  CatalogNotFoundError,
  createCatalogService,
  listCatalogServices,
  updateCatalogService,
  type CatalogGateway,
  type CatalogRow,
  type FactWriter,
} from './catalog-service'

const WS = '11111111-1111-4111-8111-111111111111'
const OTHER_WS = '99999999-9999-4999-8999-999999999999'
const SVC = '33333333-3333-4333-8333-333333333333'
const NOW = '2026-10-22T09:00:00.000Z'

const row = (patch: Partial<CatalogRow> = {}): CatalogRow => ({
  id: SVC, workspace_id: WS, name: '속눈썹 연장', price: 45000, duration_minutes: 90,
  resource_name: '원장', cancellation_policy: '24시간 전까지 무료', valid_from: null, valid_until: null,
  active: true, updated_at: '2026-10-20T00:00:00.000Z', knowledge_fact_id: null, ...patch,
})

function gateway(overrides: Partial<CatalogGateway> = {}): CatalogGateway {
  return {
    list: vi.fn().mockResolvedValue({ data: [row()], error: null }),
    find: vi.fn().mockResolvedValue({ data: row(), error: null }),
    insert: vi.fn().mockImplementation(async (payload) => ({ data: { ...row(), ...payload, updated_at: NOW }, error: null })),
    update: vi.fn().mockImplementation(async (_ws, _id, _expected, patch) => ({ data: { ...row(), ...patch, updated_at: NOW }, error: null })),
    setFactLink: vi.fn().mockImplementation(async (_ws, _id, _expected, factId) => ({
      data: { ...row(), knowledge_fact_id: factId, updated_at: NOW }, error: null,
    })),
    countStaleSlots: vi.fn().mockResolvedValue({ count: 2, error: null }),
    ...overrides,
  } as CatalogGateway
}

/**
 * A gateway that keeps its own row, so a test can read back what the code actually wrote.
 * Every method is a spy (so `mockClear()`/`toHaveBeenCalledWith` stay typed) and `read()` exposes
 * the row the previous call left behind.
 */
type StatefulGateway = CatalogGateway & {
  list: Mock
  find: Mock
  insert: Mock
  update: Mock
  setFactLink: Mock
  countStaleSlots: Mock
  read: () => CatalogRow
}

/** Same shape as `gateway()` but the link write echoes the row the previous write produced. */
function versionedGateway(): StatefulGateway {
  const base = statefulGateway()
  base.countStaleSlots.mockResolvedValue({ count: 2, error: null })
  return base
}

const factWriter = (overrides: Partial<FactWriter> = {}): FactWriter => ({
  create: vi.fn().mockResolvedValue({ id: 'fact-new' }),
  update: vi.fn().mockResolvedValue({ id: 'fact-old' }),
  findByContent: vi.fn().mockResolvedValue(null),
  ...overrides,
})

/**
 * A gateway backed by one mutable row, so create → update runs through the REAL code path
 * (the version and the service↔fact link are whatever the previous call actually wrote).
 * The old tests injected `knowledge_fact_id` straight into a mock; that is exactly how the
 * missing link write went unnoticed.
 */
function statefulGateway(initial: CatalogRow = row()): StatefulGateway {
  let current = initial
  let version = 0
  const nextVersion = () => `2026-10-21T00:00:0${++version}.000Z`

  const insert = vi.fn().mockImplementation(async (payload: Record<string, unknown>) => {
    current = { ...current, ...payload, updated_at: nextVersion() } as CatalogRow
    return { data: current, error: null }
  })
  const update = vi.fn().mockImplementation(async (_ws: string, _id: string, expected: string, patch: Record<string, unknown>) => {
    if (current.updated_at !== expected) return { data: null, error: { code: 'CATALOG_CONFLICT' } }
    current = { ...current, ...patch, updated_at: nextVersion() } as CatalogRow
    return { data: current, error: null }
  })
  const setFactLink = vi.fn().mockImplementation(async (_ws: string, _id: string, expected: string, factId: string) => {
    if (current.updated_at !== expected) return { data: null, error: { code: 'CATALOG_CONFLICT' } }
    // The link write must not move the catalog version.
    current = { ...current, knowledge_fact_id: factId }
    return { data: current, error: null }
  })

  return {
    list: vi.fn().mockImplementation(async () => ({ data: [current], error: null })),
    find: vi.fn().mockImplementation(async () => ({ data: current, error: null })),
    insert,
    update,
    setFactLink,
    countStaleSlots: vi.fn().mockResolvedValue({ count: 0, error: null }),
    read: () => current,
  }
}

describe('listCatalogServices', () => {
  it('사장님이 입력한 값과 예약 준비 상태를 함께 돌려준다', async () => {
    const gw = gateway({ list: vi.fn().mockResolvedValue({ data: [row(), row({ id: 'b', duration_minutes: null })], error: null }) })
    const result = await listCatalogServices(gw, WS, NOW)
    expect(gw.list).toHaveBeenCalledWith(WS)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ name: '속눈썹 연장', price: 45000, durationMinutes: 90, resourceName: '원장' })
    expect(result[0].readiness).toEqual({ ready: true, missing: [] })
    expect(result[1].readiness).toEqual({ ready: false, missing: ['DURATION'] })
  })

  it('다른 사업장 행이 섞여 오면 버린다(테넌트 격리)', async () => {
    const gw = gateway({ list: vi.fn().mockResolvedValue({ data: [row(), row({ id: 'x', workspace_id: OTHER_WS })], error: null }) })
    const result = await listCatalogServices(gw, WS, NOW)
    expect(result.map((s) => s.id)).toEqual([SVC])
  })

  it('조회 실패를 빈 목록으로 위장하지 않는다', async () => {
    const gw = gateway({ list: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }) })
    await expect(listCatalogServices(gw, WS, NOW)).rejects.toThrow('카탈로그를 불러오지 못했어요.')
  })
})

describe('createCatalogService', () => {
  it('사업장 ID는 입력값이 아니라 인증된 작업공간에서 온다', async () => {
    const gw = gateway()
    await createCatalogService({ gateway: gw, facts: factWriter(), workspaceId: WS, role: 'owner' }, { name: '  컷  ', price: 30000 })
    expect((gw.insert as any).mock.calls[0][0]).toMatchObject({ workspace_id: WS, name: '컷', price: 30000, duration_minutes: null })
  })

  it.each(['reviewer', 'viewer'] as const)('%s 역할은 저장할 수 없다', async (role) => {
    const gw = gateway()
    await expect(
      createCatalogService({ gateway: gw, facts: factWriter(), workspaceId: WS, role }, { name: '컷' }),
    ).rejects.toBeInstanceOf(CatalogForbiddenError)
    expect(gw.insert).not.toHaveBeenCalled()
  })

  it('잘못된 입력은 필드 메시지와 함께 거부한다', async () => {
    const gw = gateway()
    await expect(
      createCatalogService({ gateway: gw, facts: factWriter(), workspaceId: WS, role: 'owner' }, { name: '컷', durationMinutes: 0 }),
    ).rejects.toBeInstanceOf(CatalogInvalidError)
    expect(gw.insert).not.toHaveBeenCalled()
  })

  it('소요시간이 없으면 사실 동기화를 건너뛰고 그 사실을 그대로 보고한다', async () => {
    const facts = factWriter()
    const result = await createCatalogService({ gateway: gateway(), facts, workspaceId: WS, role: 'owner' }, { name: '컷', price: 30000 })
    expect(result.factSync.status).toBe('SKIPPED_INCOMPLETE')
    expect(facts.create).not.toHaveBeenCalled()
  })

  it('가격·소요시간이 있으면 기존 Fact 흐름에 사실을 남긴다', async () => {
    const facts = factWriter()
    const result = await createCatalogService({ gateway: gateway(), facts, workspaceId: WS, role: 'owner' }, {
      name: '속눈썹 연장', price: 45000, durationMinutes: 90,
    })
    expect(facts.create).toHaveBeenCalledWith({
      workspaceId: WS, category: 'MENU', content: '속눈썹 연장 — 45,000원 · 90분',
    })
    expect(result.factSync).toEqual({ status: 'SYNCED', factId: 'fact-new' })
  })

  it('생성 시 만든 Fact id 를 서비스 행에 연결한다', async () => {
    const gw = statefulGateway()
    const result = await createCatalogService({ gateway: gw, facts: factWriter(), workspaceId: WS, role: 'owner' }, {
      name: '속눈썹 연장', price: 45000, durationMinutes: 90,
    })
    // Guarded by the version the INSERT actually returned, not the one we hoped for.
    expect(gw.setFactLink).toHaveBeenCalledWith(WS, SVC, gw.read().updated_at, 'fact-new')
    expect(result.service.knowledgeFactId).toBe('fact-new')
    expect(result.factSync).toEqual({ status: 'SYNCED', factId: 'fact-new' })
  })

  it('연결 쓰기는 카탈로그 버전(updated_at)을 바꾸지 않는다', async () => {
    const gw = statefulGateway()
    const before = gw.read().updated_at
    await createCatalogService({ gateway: gw, facts: factWriter(), workspaceId: WS, role: 'owner' }, {
      name: '속눈썹 연장', price: 45000, durationMinutes: 90,
    })
    const afterInsert = gw.read().updated_at
    expect(afterInsert).not.toBe(before)
    // setFactLink ran, yet the version stayed at what the content write produced.
    expect(gw.setFactLink).toHaveBeenCalledTimes(1)
    expect(gw.read().updated_at).toBe(afterInsert)
  })

  it('연결 쓰기 실패는 저장 성공으로 위장하지 않는다', async () => {
    const gw = gateway({
      setFactLink: vi.fn().mockResolvedValue({ data: null, error: { message: 'link write failed' } }),
    })
    const result = await createCatalogService({ gateway: gw, facts: factWriter(), workspaceId: WS, role: 'owner' }, {
      name: '속눈썹 연장', price: 45000, durationMinutes: 90,
    })
    expect(result.service.price).toBe(45000)
    expect(result.factSync.status).toBe('FAILED')
    expect((result.factSync as { message: string }).message).toContain('연결')
    expect((result.factSync as { message: string }).message).toContain('link write failed')
  })

  it.each([
    ['SKIPPED_INCOMPLETE', { name: '컷', price: 30000 }],
    ['SKIPPED_FUTURE_EFFECTIVE_DATE', { name: '컷', price: 30000, durationMinutes: 30, validFrom: '2026-12-01T00:00:00+09:00' }],
  ])('사실을 건너뛴 경우(%s) 연결을 건드리지 않는다', async (status, input) => {
    const gw = gateway()
    const result = await createCatalogService({ gateway: gw, facts: factWriter(), workspaceId: WS, role: 'owner' }, input)
    expect(result.factSync.status).toBe(status)
    expect(gw.setFactLink).not.toHaveBeenCalled()
  })
})

describe('updateCatalogService', () => {
  it('다른 사업장 서비스는 존재 여부도 알려주지 않는다', async () => {
    const gw = gateway({ find: vi.fn().mockResolvedValue({ data: null, error: null }) })
    await expect(
      updateCatalogService({ gateway: gw, facts: factWriter(), workspaceId: WS, role: 'owner' }, SVC, {
        expectedUpdatedAt: '2026-10-20T00:00:00.000Z', price: 50000,
      }),
    ).rejects.toBeInstanceOf(CatalogNotFoundError)
    expect(gw.update).not.toHaveBeenCalled()
  })

  it('조회된 행의 사업장이 다르면 거부한다', async () => {
    const gw = gateway({ find: vi.fn().mockResolvedValue({ data: row({ workspace_id: OTHER_WS }), error: null }) })
    await expect(
      updateCatalogService({ gateway: gw, facts: factWriter(), workspaceId: WS, role: 'owner' }, SVC, {
        expectedUpdatedAt: '2026-10-20T00:00:00.000Z', price: 50000,
      }),
    ).rejects.toBeInstanceOf(CatalogNotFoundError)
  })

  it('그 사이 다른 곳에서 수정됐으면 덮어쓰지 않고 충돌을 알린다', async () => {
    const gw = gateway()
    await expect(
      updateCatalogService({ gateway: gw, facts: factWriter(), workspaceId: WS, role: 'owner' }, SVC, {
        expectedUpdatedAt: '2026-10-01T00:00:00.000Z', price: 50000,
      }),
    ).rejects.toBeInstanceOf(CatalogConflictError)
    expect(gw.update).not.toHaveBeenCalled()
  })

  it('변경에 성공하면 재확인이 필요한 가용 시간 개수를 함께 알린다', async () => {
    const gw = versionedGateway()
    const result = await updateCatalogService({ gateway: gw, facts: factWriter(), workspaceId: WS, role: 'owner' }, SVC, {
      expectedUpdatedAt: '2026-10-20T00:00:00.000Z', price: 50000,
    })
    expect(gw.countStaleSlots).toHaveBeenCalledWith(WS, SVC, gw.read().updated_at)
    expect(result.slotsRequiringReconfirmation).toBe(2)
    expect(result.service.price).toBe(50000)
  })

  it('가격·소요시간이 그대로면 사실을 다시 쓰지 않는다(거짓 초안 무효화 금지)', async () => {
    const facts = factWriter()
    const result = await updateCatalogService({ gateway: gateway(), facts, workspaceId: WS, role: 'owner' }, SVC, {
      expectedUpdatedAt: '2026-10-20T00:00:00.000Z', cancellationPolicy: '24시간 전까지 무료',
    }, NOW)
    expect(result.factSync).toEqual({ status: 'SKIPPED_UNCHANGED' })
    expect(facts.create).not.toHaveBeenCalled()
    expect(facts.update).not.toHaveBeenCalled()
  })

  it('적용일이 미래면 오늘 가격으로 사실을 덮지 않는다(ANI-1601 적용일 흐름과 충돌 금지)', async () => {
    const facts = factWriter()
    const result = await updateCatalogService({ gateway: gateway(), facts, workspaceId: WS, role: 'owner' }, SVC, {
      expectedUpdatedAt: '2026-10-20T00:00:00.000Z', price: 50000, validFrom: '2026-11-01T00:00:00+09:00',
    }, NOW)
    expect(facts.create).not.toHaveBeenCalled()
    expect(facts.update).not.toHaveBeenCalled()
    expect(result.factSync.status).toBe('SKIPPED_FUTURE_EFFECTIVE_DATE')
  })

  it('이미 사실이 연결돼 있으면 새로 만들지 않고 기존 사실을 갱신한다', async () => {
    // No injection: the create call must have written the link for this to work.
    const gw = statefulGateway()
    const facts = factWriter()
    const actor = { gateway: gw, facts, workspaceId: WS, role: 'owner' as const }
    await createCatalogService(actor, { name: '속눈썹 연장', price: 45000, durationMinutes: 90 }, NOW)
    const linkedFactId = gw.read().knowledge_fact_id
    expect(linkedFactId).toBe('fact-new')

    const result = await updateCatalogService(actor, SVC, {
      expectedUpdatedAt: gw.read().updated_at, durationMinutes: 120,
    }, NOW)
    expect(facts.update).toHaveBeenCalledWith({
      workspaceId: WS, factId: 'fact-new', content: '속눈썹 연장 — 45,000원 · 120분',
    })
    expect(result.factSync).toEqual({ status: 'SYNCED', factId: 'fact-old' })
  })

  it('수정 시 새 Fact id 로 연결을 갱신한다(다음 저장이 supersede 할 수 있게)', async () => {
    const gw = statefulGateway()
    const facts = factWriter()
    const actor = { gateway: gw, facts, workspaceId: WS, role: 'owner' as const }
    await createCatalogService(actor, { name: '속눈썹 연장', price: 45000, durationMinutes: 90 }, NOW)

    // create → fact-new, update → fact-old (the writer's return value, i.e. the successor).
    gw.setFactLink.mockClear()
    await updateCatalogService(actor, SVC, { expectedUpdatedAt: gw.read().updated_at, price: 52000 }, NOW)

    expect(gw.setFactLink).toHaveBeenCalledWith(WS, SVC, gw.read().updated_at, 'fact-old')
    expect(gw.read().knowledge_fact_id).toBe('fact-old')
  })

  it('연결이 비어 있으면 직전 내용으로 기존 Fact 를 채택한다(깨진 행 자기치유)', async () => {
    // A row saved before the link write existed: knowledge_fact_id is NULL.
    const gw = statefulGateway(row({ knowledge_fact_id: null }))
    const facts = factWriter({ findByContent: vi.fn().mockResolvedValue({ id: 'fact-legacy' }) })
    const result = await updateCatalogService({ gateway: gw, facts, workspaceId: WS, role: 'owner' }, SVC, {
      expectedUpdatedAt: gw.read().updated_at, price: 52000,
    }, NOW)

    expect(facts.findByContent).toHaveBeenCalledWith({
      workspaceId: WS, category: 'MENU', content: '속눈썹 연장 — 45,000원 · 90분',
    })
    // Adopted, so no duplicate active claim is forked.
    expect(facts.create).not.toHaveBeenCalled()
    expect(facts.update).toHaveBeenCalledWith({
      workspaceId: WS, factId: 'fact-legacy', content: '속눈썹 연장 — 52,000원 · 90분',
    })
    expect(result.factSync).toEqual({ status: 'SYNCED', factId: 'fact-old' })
    expect(gw.read().knowledge_fact_id).toBe('fact-old')
  })

  it('채택 조회가 실패해도 저장은 계속되고 새 Fact 로 넘어간다', async () => {
    const gw = statefulGateway(row({ knowledge_fact_id: null }))
    const facts = factWriter({ findByContent: vi.fn().mockRejectedValue(new Error('lookup down')) })
    const result = await updateCatalogService({ gateway: gw, facts, workspaceId: WS, role: 'owner' }, SVC, {
      expectedUpdatedAt: gw.read().updated_at, price: 52000,
    }, NOW)
    expect(facts.create).toHaveBeenCalled()
    expect(result.factSync.status).toBe('SYNCED')
    expect(result.service.price).toBe(52000)
  })

  it('연결 쓰기는 content 쓰기가 반환한 버전으로 가드된다(조회 시점 값이 아니다)', async () => {
    const gw = statefulGateway()
    const facts = factWriter()
    const actor = { gateway: gw, facts, workspaceId: WS, role: 'owner' as const }
    await createCatalogService(actor, { name: '속눈썹 연장', price: 45000, durationMinutes: 90 }, NOW)

    const versionBeforeEdit = gw.read().updated_at
    gw.setFactLink.mockClear()
    await updateCatalogService(actor, SVC, { expectedUpdatedAt: versionBeforeEdit, price: 52000 }, NOW)

    const versionAfterEdit = gw.read().updated_at
    expect(versionAfterEdit).not.toBe(versionBeforeEdit)
    expect(gw.setFactLink).toHaveBeenCalledWith(WS, SVC, versionAfterEdit, 'fact-old')
  })

  it('사실을 건너뛴 수정은 연결을 건드리지 않는다', async () => {
    const gw = statefulGateway()
    const actor = { gateway: gw, facts: factWriter(), workspaceId: WS, role: 'owner' as const }
    await createCatalogService(actor, { name: '속눈썹 연장', price: 45000, durationMinutes: 90 }, NOW)
    gw.setFactLink.mockClear()

    const unchanged = await updateCatalogService(actor, SVC, {
      expectedUpdatedAt: gw.read().updated_at, cancellationPolicy: '24시간 전까지 무료',
    }, NOW)
    expect(unchanged.factSync).toEqual({ status: 'SKIPPED_UNCHANGED' })

    const incomplete = await updateCatalogService(actor, SVC, {
      expectedUpdatedAt: gw.read().updated_at, durationMinutes: null,
    }, NOW)
    expect(incomplete.factSync.status).toBe('SKIPPED_INCOMPLETE')
    expect(gw.setFactLink).not.toHaveBeenCalled()
  })

  it('사실 갱신이 실패해도 저장 성공으로 위장하지 않고 실패를 보고한다', async () => {
    const gw = statefulGateway()
    const facts = factWriter({ update: vi.fn().mockRejectedValue(new Error('fact db down')) })
    const actor = { gateway: gw, facts, workspaceId: WS, role: 'owner' as const }
    await createCatalogService(actor, { name: '속눈썹 연장', price: 45000, durationMinutes: 90 }, NOW)
    gw.setFactLink.mockClear()

    const result = await updateCatalogService(actor, SVC, {
      expectedUpdatedAt: gw.read().updated_at, price: 51000,
    }, NOW)
    expect(result.service.price).toBe(51000)
    expect(result.factSync).toEqual({ status: 'FAILED', message: 'fact db down' })
    // The fact write failed, so the link must not be repointed at a fact that does not exist.
    expect(gw.setFactLink).not.toHaveBeenCalled()
  })

  it('동시에 같은 행을 고쳐 쓰기 직전에 밀렸으면 덮어쓰지 않고 충돌로 알린다', async () => {
    const gw = gateway({ update: vi.fn().mockResolvedValue({ data: null, error: { code: 'CATALOG_CONFLICT' } }) })
    await expect(
      updateCatalogService({ gateway: gw, facts: factWriter(), workspaceId: WS, role: 'owner' }, SVC, {
        expectedUpdatedAt: '2026-10-20T00:00:00.000Z', price: 50000,
      }),
    ).rejects.toBeInstanceOf(CatalogConflictError)
  })

  it('저장 실패는 예외로 알린다', async () => {
    const gw = gateway({ update: vi.fn().mockResolvedValue({ data: null, error: { message: 'rls' } }) })
    await expect(
      updateCatalogService({ gateway: gw, facts: factWriter(), workspaceId: WS, role: 'owner' }, SVC, {
        expectedUpdatedAt: '2026-10-20T00:00:00.000Z', price: 50000,
      }),
    ).rejects.toThrow('저장하지 못했어요.')
  })
})
