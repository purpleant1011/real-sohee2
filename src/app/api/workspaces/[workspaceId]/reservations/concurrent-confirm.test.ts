import { describe, expect, it, vi } from 'vitest'
import { buildLedgerSnapshot, type ReservationLedgerRow } from '@/app/app/schedule/ledger-snapshot'
import { ReservationCanonicalService } from '@/features/reservations/reservation-canonical-service'

/**
 * M15 예약 장부(ANI-1691) 잔여 AC — 동시 확정 경쟁.
 *
 * 같은 가게의 같은 슬롯을 두 요청이 동시에 확정하면 **정확히 한 건만** 확정되고, 진 요청은
 * 성공으로 새지 않고 409 `SLOT_ALREADY_RESERVED` 로 닫힌다(사용자에게는 `SLOT_CONFLICT`
 * '이미 마감'으로 내려간다). 둘 다 성공하거나, 둘 다 실패하거나, 진 요청이 500 으로 새면 실패다.
 *
 * 방어선은 두 겹이고 각각 따로 고정한다.
 * 1) 프로세스 안 — `SlotLockManager` 직렬화 + 메모리/DB 재확인 (같은 모듈 인스턴스).
 * 2) 프로세스 밖 — `reservations (workspace_id, slot_id) WHERE status='CONFIRMED'` 부분
 *    유니크 인덱스(`idx_reservations_active_slot`)가 두 번째 INSERT 를 23505 로 막는다.
 *    이 겹은 모듈을 두 벌 로드해 메모리 상태를 공유하지 않게 만들어 검증한다.
 *
 * 이 테스트는 제품 코드를 바꾸지 않는다. DB 는 실제 PostgREST 가 아니라 위 두 계약
 * (CONFIRMED 조건 조회 + 부분 유니크 인덱스)을 흉내 낸 가짜 표다. 실제 DB 경합은
 * 격리 PostgreSQL 하네스(`npm run test:booking-recovery-db`)의 몫이다.
 */

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }))
vi.mock('@/features/booking-recovery/production', () => ({ isRecoveryEnabled: () => false }))
vi.mock('@/lib/evidence/proof-chain-service', () => ({
  ProofChainService: {
    initiateProof: vi.fn(async () => ({ evidenceId: 'ev_race_test' })),
    markProviderAccepted: vi.fn(async () => ({})),
  },
}))

const SERVICE_MODULE = '@/features/reservations/reservation-canonical-service'
const WORKSPACE = 'ws-race'
const OTHER_WORKSPACE = 'ws-race-other'
const SLOT = 'slot-race-1000'
const CHECKED_AT = '2026-10-24T10:00:00.000Z'

type FakeRow = Record<string, unknown>

interface FakeReservationsDb {
  client: { from: (table: string) => unknown }
  rows: () => FakeRow[]
  confirmedCount: () => number
  rowsOfCustomer: (customerId: string) => FakeRow[]
  calls: { select: number; insert: number }
}

/**
 * 실제 PostgREST 대신 쓰는 예약 표. 지키는 계약은 두 가지다.
 * - `.eq('status','CONFIRMED')` 로 거른 조건 조회가 가능하다.
 * - `(workspace_id, slot_id) WHERE status='CONFIRMED'` 부분 유니크 인덱스가 중복 INSERT 를 23505 로 막는다.
 *
 * 조회 응답을 일부러 미뤄, 두 요청이 서로의 INSERT 를 보지 못한 채 동시에 들어오는
 * (서로 다른 isolate 에서 온) 상황을 재현한다.
 */
function createFakeReservationsDb(): FakeReservationsDb {
  const rows: FakeRow[] = []
  const calls = { select: 0, insert: 0 }
  const slack = () => new Promise<void>((resolve) => setTimeout(resolve, 5))

  function reservationsTable() {
    const filters: Array<[string, unknown]> = []
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters.push([column, value])
        return chain
      },
      maybeSingle: async (): Promise<{ data: FakeRow | null; error: null }> => {
        calls.select += 1
        // 스냅샷은 지금, 응답은 잠시 뒤. 동시에 들어온 두 요청 모두 빈 표를 본다.
        const found = rows.find((row) => filters.every(([column, value]) => row[column] === value)) ?? null
        await slack()
        return { data: found ? { ...found } : null, error: null }
      },
      insert: async (row: FakeRow): Promise<{ error: { code: string; message: string } | null }> => {
        calls.insert += 1
        await slack()
        const conflicts = row.status === 'CONFIRMED' && rows.some(
          (existing) =>
            existing.status === 'CONFIRMED' &&
            existing.workspace_id === row.workspace_id &&
            existing.slot_id === row.slot_id,
        )
        if (conflicts) {
          return {
            error: {
              code: '23505',
              message: 'duplicate key value violates unique constraint "idx_reservations_active_slot"',
            },
          }
        }
        // 실제 표의 기본값과 같게 metadata 는 빈 객체로 둔다(근거 미기록).
        rows.push({ metadata: {}, ...row })
        return { error: null }
      },
    }
    return chain
  }

  function emptyTable() {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
    }
    return chain
  }

  return {
    client: {
      from: (table: string) => (table === 'reservations' ? reservationsTable() : emptyTable()),
    },
    rows: () => rows.map((row) => ({ ...row })),
    confirmedCount: () => rows.filter((row) => row.status === 'CONFIRMED').length,
    rowsOfCustomer: (customerId: string) => rows.filter((row) => row.customer_id === customerId),
    calls,
  }
}

function confirmParams(customerId: string, workspaceId = WORKSPACE) {
  return {
    workspaceId,
    slotId: SLOT,
    customerId,
    customerName: '김민지',
    serviceId: 'srv_lash',
    serviceName: '속눈썹 연장',
    depositKrw: 0,
    totalAmountKrw: 60000,
    channelSource: 'INSTAGRAM_DM',
  }
}

function splitSettled<T>(settled: Array<PromiseSettledResult<T>>) {
  const ok = settled.filter((r): r is PromiseFulfilledResult<T> => r.status === 'fulfilled')
  const failed = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  return { ok, failed }
}

function ledgerRows(rows: FakeRow[]): ReservationLedgerRow[] {
  return rows as unknown as ReservationLedgerRow[]
}

describe('같은 슬롯 동시 확정 — 프로세스 안 직렬화', () => {
  it('한 요청만 확정되고 다른 요청은 409 로 닫힌다', async () => {
    ReservationCanonicalService.resetState()
    const db = createFakeReservationsDb()

    const settled = await Promise.allSettled([
      ReservationCanonicalService.createReservation(confirmParams('cust-a'), db.client),
      ReservationCanonicalService.createReservation(confirmParams('cust-b'), db.client),
    ])
    const { ok, failed } = splitSettled(settled)

    expect(ok).toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect(failed[0].reason).toMatchObject({ code: 'SLOT_ALREADY_RESERVED', statusCode: 409 })
    // 확정은 정확히 1건, 진 요청의 고객 행은 아예 생기지 않는다.
    expect(db.confirmedCount()).toBe(1)
    const loser = ok[0].value.customerId === 'cust-a' ? 'cust-b' : 'cust-a'
    expect(db.rowsOfCustomer(loser)).toHaveLength(0)
    expect(db.rows()[0].id).toBe(ok[0].value.bookingId)
  })

  it('경쟁이 끝난 뒤 같은 확정을 다시 보내도 성공으로 되돌아오지 않는다', async () => {
    ReservationCanonicalService.resetState()
    const db = createFakeReservationsDb()

    const winner = await ReservationCanonicalService.createReservation(confirmParams('cust-a'), db.client)
    await expect(
      ReservationCanonicalService.createReservation(confirmParams('cust-a'), db.client),
    ).rejects.toMatchObject({ code: 'SLOT_ALREADY_RESERVED', statusCode: 409 })
    expect(db.confirmedCount()).toBe(1)
    expect(db.rows()[0].id).toBe(winner.bookingId)
  })
})

describe('같은 슬롯 동시 확정 — 프로세스 밖(모듈 2벌)', () => {
  it('메모리 락이 공유되지 않아도 DB 유니크 제약이 두 번째 확정을 409 로 막는다', async () => {
    ReservationCanonicalService.resetState()
    const db = createFakeReservationsDb()

    // 모듈을 한 벌 더 로드한다 → lockManager/activeSlotMap 이 따로인, 다른 isolate 와 같은 상태.
    vi.resetModules()
    const otherIsolate = await import(SERVICE_MODULE)
    expect(otherIsolate.ReservationCanonicalService).not.toBe(ReservationCanonicalService)

    const settled = await Promise.allSettled([
      ReservationCanonicalService.createReservation(confirmParams('cust-a'), db.client),
      otherIsolate.ReservationCanonicalService.createReservation(confirmParams('cust-b'), db.client),
    ])
    const { ok, failed } = splitSettled(settled)

    expect(ok).toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect(failed[0].reason).toMatchObject({ code: 'SLOT_ALREADY_RESERVED', statusCode: 409 })
    // 두 요청이 모두 INSERT 까지 갔고, 두 번째가 DB 제약조건에서 잘렸다는 증거.
    expect(db.calls.insert).toBe(2)
    expect(failed[0].reason.message).toContain('DB 제약조건')
    expect(db.confirmedCount()).toBe(1)
  })
})

describe('경쟁 뒤 장부 정합', () => {
  it('장부 스냅샷에는 같은 슬롯의 확정 행이 한 건만 올라온다', async () => {
    ReservationCanonicalService.resetState()
    const db = createFakeReservationsDb()

    await Promise.allSettled([
      ReservationCanonicalService.createReservation(confirmParams('cust-a'), db.client),
      ReservationCanonicalService.createReservation(confirmParams('cust-b'), db.client),
    ])

    const snapshot = buildLedgerSnapshot({
      workspaceId: WORKSPACE,
      timeZone: 'Asia/Seoul',
      rows: ledgerRows(db.rows()),
      error: null,
      checkedAt: CHECKED_AT,
      datasetMode: 'ACTUAL', // 이 unit fixture는 실제 데이터 분류를 명시한다. 운영 증거는 아니다.
    })

    expect(snapshot.loadState).toBe('ready')
    expect(snapshot.entries).toHaveLength(1)
    expect(snapshot.entries[0].status).toBe('confirmed')
    expect(snapshot.entries[0].workspaceId).toBe(WORKSPACE)
  })

  it('다른 가게의 같은 슬롯 id 는 경쟁 상대가 아니다', async () => {
    ReservationCanonicalService.resetState()
    const db = createFakeReservationsDb()

    const settled = await Promise.allSettled([
      ReservationCanonicalService.createReservation(confirmParams('cust-a'), db.client),
      ReservationCanonicalService.createReservation(confirmParams('cust-b', OTHER_WORKSPACE), db.client),
    ])
    const { ok } = splitSettled(settled)

    // 테넌트가 다르면 각자 확정된다(교차 테넌트 차단이 아니라 격리).
    expect(ok).toHaveLength(2)
    expect(db.confirmedCount()).toBe(2)

    const snapshot = buildLedgerSnapshot({
      workspaceId: WORKSPACE,
      timeZone: 'Asia/Seoul',
      rows: ledgerRows(db.rows()),
      error: null,
      checkedAt: CHECKED_AT,
      datasetMode: 'ACTUAL', // 이 unit fixture는 실제 데이터 분류를 명시한다. 운영 증거는 아니다.
    })
    // 서버 쿼리는 workspace_id 로 거르지만, 두 가게 행이 섞여 들어온 조회는
    // 장부가 조용히 골라내지 않고 error 로 닫는다(교차 노출·누락 모두 fail-closed).
    expect(snapshot.loadState).toBe('error')
    expect(snapshot.entries).toEqual([])
  })
})
