import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Home5PriorityBuilder,
} from '../home-5-priority-read-model'

describe('Owner Commercial UX 2.0 · Home 5 Priority Read Model (ANI-1191, ANI-1220, ANI-1221)', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const missionId = 'msn-byreum-active-001'

  let mockMissionsDb: Record<string, any> = {}
  let mockReservationsDb: Record<string, any> = {}
  let mockReservationsError: any = null

  const mockSupabaseClient = {
    from: (table: string) => {
      if (table === 'marketing_missions') {
        return {
          select: vi.fn().mockImplementation(() => {
            const filters: Array<{ col: string; val: any }> = []
            const chain = {
              eq: (col: string, val: any) => {
                filters.push({ col, val })
                return chain
              },
              order: () => chain,
              limit: () => ({
                then: (cb: any) => {
                  const filtered = Object.values(mockMissionsDb).filter(r =>
                    filters.every(f => r[f.col] === f.val)
                  )
                  return cb({ data: filtered, error: null })
                },
              }),
            }
            return chain
          }),
        }
      }

      if (table === 'reservations') {
        return {
          select: vi.fn().mockImplementation(() => {
            const chain = {
              eq: () => chain,
              then: (cb: any) => cb({
                data: mockReservationsError ? null : Object.values(mockReservationsDb),
                error: mockReservationsError,
              }),
            }
            return chain
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  } as any

  beforeEach(() => {
    mockMissionsDb = {}
    mockReservationsDb = {}
    mockReservationsError = null
  })

  it('1. MUST construct concise Home 5 Priority view from active mission and verified outcomes', async () => {
    mockMissionsDb[missionId] = {
      id: missionId,
      workspace_id: workspaceId,
      trace_id: 'trc-home-001',
      status: 'NEXT_ACTION_READY',
      goal: '가을 자연눈썹 10명 모객',
      content_id: 'cnt-001',
      content_version_id: 'ver-001',
      approval_id: 'appr-001',
      booking_id: 'bk-001',
      metadata: {
        owner_action_required: true,
        next_best_action: {
          actionId: 'nba-001',
          title: '주말 2차 잔여 슬롯 마감 숏폼 릴스 발행',
          confidence: 94,
          requiresApproval: true,
        },
      },
      created_at: '2026-09-10T10:00:00.000Z',
      updated_at: '2026-09-10T12:00:00.000Z',
    }

    mockReservationsDb['bk-001'] = {
      id: 'bk-001',
      workspace_id: workspaceId,
      status: 'CONFIRMED',
      total_amount_krw: 180000,
      customer_name: '김서연 고객님',
    }

    const builder = new Home5PriorityBuilder(mockSupabaseClient)
    const view = await builder.buildHome5Priority(workspaceId)

    expect(view.hasActiveMission).toBe(true)

    // Priority 1: Today's Goal
    expect(view.priority1_todayGoal.goal).toBe('가을 자연눈썹 10명 모객')
    expect(view.priority1_todayGoal.targetChannel).toBe('인스타그램')

    // Priority 2: Sohee's Current Work
    expect(view.priority2_soheeWorkingOn.statusBadge).toBe('ACTION_REQUIRED')
    expect(view.priority2_soheeWorkingOn.currentTaskSummary).toContain('후속 마케팅 추천 행동')

    // Priority 3: Owner Decision
    expect(view.priority3_ownerDecisions.requiresAction).toBe(true)
    expect(view.priority3_ownerDecisions.actionTitle).toContain('주말 2차 잔여 슬롯')

    // Priority 4: Verified Outcome
    expect(view.priority4_verifiedOutcome.confirmedBookingsCount).toBe(1)
    expect(view.priority4_verifiedOutcome.verifiedRevenueKrw).toBeNull()
    expect(view.priority4_verifiedOutcome.revenueState).toBe('NOT_OBSERVED')
    expect(view.priority4_verifiedOutcome.isSourceBacked).toBe(true)
    // 예약 건수는 예약 원장에서 읽었으므로 출처와 확인 상태를 함께 남긴다.
    expect(view.priority4_verifiedOutcome.bookingCountSource).toBe('reservations.created_at/current_status')
    expect(view.priority4_verifiedOutcome.bookingCountConfirmation).toBe('CONFIRMED')
    // 매출은 입금 원장이 연결되지 않았으므로 숫자도 출처도 없다.
    expect(view.priority4_verifiedOutcome.revenueSource).toBeNull()
    expect(view.priority4_verifiedOutcome.revenueConfirmation).toBe('UNCONFIRMED')

    // Priority 5: Next Best Action
    expect(view.priority5_nextBestAction.title).toBe('주말 2차 잔여 슬롯 마감 숏폼 릴스 발행')
    expect(view.priority5_nextBestAction.confidence).toBe(94)
  })

  it('2. MUST honestly show empty state when there are no active missions without showing fake KPIs', async () => {
    const builder = new Home5PriorityBuilder(mockSupabaseClient)
    const view = await builder.buildHome5Priority(workspaceId)

    expect(view.hasActiveMission).toBe(false)
    expect(view.priority1_todayGoal.goal).toContain('진행 중인 마케팅 업무가 없습니다')
    expect(view.priority4_verifiedOutcome.confirmedBookingsCount).toBe(0)
    expect(view.priority4_verifiedOutcome.verifiedRevenueKrw).toBeNull()
    expect(view.priority4_verifiedOutcome.revenueState).toBe('NOT_OBSERVED')
    expect(view.priority4_verifiedOutcome.isSourceBacked).toBe(true) // no fake statistics!
    // 조회에 성공한 0건은 근거 있는 0건이다. 확인된 값이므로 숫자로 표시해도 된다.
    expect(view.priority4_verifiedOutcome.bookingCountSource).toBe('reservations.created_at/current_status')
    expect(view.priority4_verifiedOutcome.bookingCountConfirmation).toBe('CONFIRMED')
  })

  it('3. MUST NOT report confirmed booking amounts as verified revenue without payment evidence', async () => {
    mockMissionsDb[missionId] = {
      id: missionId,
      workspace_id: workspaceId,
      status: 'PUBLISHED_VERIFIED',
      goal: '가을 자연눈썹 10명 모객',
      metadata: {},
      created_at: '2026-09-10T10:00:00.000Z',
    }

    mockReservationsDb['bk-001'] = {
      id: 'bk-001',
      workspace_id: workspaceId,
      status: 'CONFIRMED',
      total_amount_krw: 180000,
      servicePrice: 180000,
    }

    const builder = new Home5PriorityBuilder(mockSupabaseClient)
    const view = await builder.buildHome5Priority(workspaceId)
    const outcome = view.priority4_verifiedOutcome

    expect(outcome.confirmedBookingsCount).toBe(1)
    expect(outcome.verifiedRevenueKrw).toBeNull()
    expect(outcome.revenueState).toBe('NOT_OBSERVED')
    expect(outcome.isSourceBacked).toBe(true)
    expect(outcome.bookingCountSource).toBe('reservations.created_at/current_status')
    expect(outcome.bookingCountConfirmation).toBe('CONFIRMED')
    expect(outcome.revenueSource).toBeNull()
    expect(outcome.revenueConfirmation).toBe('UNCONFIRMED')
    expect(outcome.narrative).toContain('1건')
    expect(outcome.narrative).toContain('입금 확인 근거가 연결되지 않아')
    expect(outcome.narrative).not.toContain('₩')
  })

  it('4. MUST NOT report 0 confirmed bookings when the reservations lookup fails', async () => {
    mockMissionsDb[missionId] = {
      id: missionId,
      workspace_id: workspaceId,
      status: 'PUBLISHED_VERIFIED',
      goal: '가을 자연눈썹 10명 모객',
      metadata: {},
      created_at: '2026-09-10T10:00:00.000Z',
    }
    mockReservationsError = { message: 'reservations query failed' }

    const builder = new Home5PriorityBuilder(mockSupabaseClient)
    const view = await builder.buildHome5Priority(workspaceId)
    const outcome = view.priority4_verifiedOutcome

    expect(outcome.confirmedBookingsCount).toBeNull()
    expect(outcome.verifiedRevenueKrw).toBeNull()
    expect(outcome.revenueState).toBe('ERROR')
    expect(outcome.isSourceBacked).toBe(false)
    // 조회 실패는 0건도 아니고 '확인 안 됨'과도 구분되는 ERROR 로 남긴다.
    expect(outcome.bookingCountSource).toBeNull()
    expect(outcome.bookingCountConfirmation).toBe('ERROR')
    expect(outcome.revenueSource).toBeNull()
    expect(outcome.revenueConfirmation).toBe('UNCONFIRMED')
    expect(outcome.narrative).toBe('예약 기록을 확인하지 못했어요. 0건으로 계산하지 않았어요.')
    expect(outcome.narrative).not.toContain('아직 확정된 예약 성과가 없습니다')
  })
})
