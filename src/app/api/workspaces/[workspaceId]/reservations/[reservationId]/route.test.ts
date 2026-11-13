import { describe, expect, it, vi, beforeEach } from 'vitest'
import { PATCH } from './route'

const mockAuth = vi.fn()
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: (...args: any[]) => mockAuth(...args),
  isResponse: (v: any) => v && typeof v.status === 'number',
}))

describe('PATCH /api/workspaces/[workspaceId]/reservations/[reservationId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('인증 실패 시 인증 응답을 그대로 반환한다', async () => {
    mockAuth.mockResolvedValueOnce(new Response(JSON.stringify({ error: '인증이 필요합니다.' }), { status: 401 }))

    const req = new Request('https://example.com/api/workspaces/ws-1/reservations/res-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'cancel', reason: '고객 단순 변심' }),
    })
    const res = await PATCH(req, {
      params: Promise.resolve({ workspaceId: 'ws-1', reservationId: 'res-1' }),
    })
    expect(res.status).toBe(401)
  })

  it('action이 누락되거나 지원하지 않는 action인 경우 422를 반환한다', async () => {
    mockAuth.mockResolvedValueOnce({ workspaceId: 'ws-1', admin: {} })

    const req = new Request('https://example.com/api/workspaces/ws-1/reservations/res-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'unknown' }),
    })
    const res = await PATCH(req, {
      params: Promise.resolve({ workspaceId: 'ws-1', reservationId: 'res-1' }),
    })
    expect(res.status).toBe(422)
  })

  describe('action: cancel', () => {
    it('사유가 누락되거나 빈 문자열이면 422를 반환한다', async () => {
      mockAuth.mockResolvedValueOnce({ workspaceId: 'ws-1', admin: {} })

      const req = new Request('https://example.com/api/workspaces/ws-1/reservations/res-1', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'cancel', reason: '   ' }),
      })
      const res = await PATCH(req, {
        params: Promise.resolve({ workspaceId: 'ws-1', reservationId: 'res-1' }),
      })
      expect(res.status).toBe(422)
      const json = await res.json()
      expect(json.error).toBeTruthy()
    })

    it('사유가 200자를 초과하면 422를 반환한다', async () => {
      mockAuth.mockResolvedValueOnce({ workspaceId: 'ws-1', admin: {} })

      const req = new Request('https://example.com/api/workspaces/ws-1/reservations/res-1', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'cancel', reason: 'a'.repeat(201) }),
      })
      const res = await PATCH(req, {
        params: Promise.resolve({ workspaceId: 'ws-1', reservationId: 'res-1' }),
      })
      expect(res.status).toBe(422)
    })

    it('예약이 존재하지 않으면 404를 반환하고 에러 메시지에 번호나 이름을 노출하지 않는다', async () => {
      const mockAdmin = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          })),
        })),
      }
      mockAuth.mockResolvedValueOnce({ workspaceId: 'ws-1', admin: mockAdmin })

      const req = new Request('https://example.com/api/workspaces/ws-1/reservations/res-not-found', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'cancel', reason: '고객 요청 취소' }),
      })
      const res = await PATCH(req, {
        params: Promise.resolve({ workspaceId: 'ws-1', reservationId: 'res-not-found' }),
      })
      expect(res.status).toBe(404)
      const json = await res.json()
      expect(json.error).toBe('예약을 찾을 수 없습니다.')
    })

    it('다른 workspace 소유의 예약이면 404를 반환한다', async () => {
      const mockAdmin = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'res-other',
                  workspace_id: 'ws-other',
                  status: 'CONFIRMED',
                },
                error: null,
              }),
            })),
          })),
        })),
      }
      mockAuth.mockResolvedValueOnce({ workspaceId: 'ws-1', admin: mockAdmin })

      const req = new Request('https://example.com/api/workspaces/ws-1/reservations/res-other', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'cancel', reason: '취소' }),
      })
      const res = await PATCH(req, {
        params: Promise.resolve({ workspaceId: 'ws-1', reservationId: 'res-other' }),
      })
      expect(res.status).toBe(404)
      const json = await res.json()
      expect(json.error).toBe('예약을 찾을 수 없습니다.')
    })

    it('이미 CANCELLED 상태인 예약은 UPDATE하지 않고 멱등 200 + status: already를 반환한다', async () => {
      const mockUpdate = vi.fn()
      const mockAdmin = {
        from: vi.fn((table: string) => {
          if (table === 'reservations') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'res-already-cancelled',
                      workspace_id: 'ws-1',
                      status: 'CANCELLED',
                      cancel_reason: '이전 취소 사유',
                      cancelled_at: '2026-11-08T10:00:00Z',
                    },
                    error: null,
                  }),
                })),
              })),
              update: mockUpdate,
            }
          }
          return {}
        }),
      }
      mockAuth.mockResolvedValueOnce({ workspaceId: 'ws-1', admin: mockAdmin })

      const req = new Request('https://example.com/api/workspaces/ws-1/reservations/res-already-cancelled', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'cancel', reason: '중복 취소 시도' }),
      })
      const res = await PATCH(req, {
        params: Promise.resolve({ workspaceId: 'ws-1', reservationId: 'res-already-cancelled' }),
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(json.status).toBe('already')
      expect(json.reservationId).toBe('res-already-cancelled')
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('정상 취소 시 reservations UPDATE로 status CANCELLED, cancel_reason, cancelled_at을 설정하고 200 + status: cancelled를 반환한다', async () => {
      let updatePayload: any = null
      const mockUpdate = vi.fn((payload: any) => {
        updatePayload = payload
        return {
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'res-valid',
                    workspace_id: 'ws-1',
                    status: 'CANCELLED',
                    cancel_reason: '고객 일정 불가',
                    cancelled_at: payload.cancelled_at,
                    updated_at: payload.updated_at,
                  },
                  error: null,
                }),
              })),
            })),
          })),
        }
      })

      const mockAdmin = {
        from: vi.fn((table: string) => {
          if (table === 'reservations') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'res-valid',
                      workspace_id: 'ws-1',
                      status: 'CONFIRMED',
                    },
                    error: null,
                  }),
                })),
              })),
              update: mockUpdate,
            }
          }
          return {}
        }),
      }
      mockAuth.mockResolvedValueOnce({ workspaceId: 'ws-1', admin: mockAdmin })

      const req = new Request('https://example.com/api/workspaces/ws-1/reservations/res-valid', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'cancel', reason: '고객 일정 불가' }),
      })
      const res = await PATCH(req, {
        params: Promise.resolve({ workspaceId: 'ws-1', reservationId: 'res-valid' }),
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(json.status).toBe('cancelled')
      expect(updatePayload).toMatchObject({
        status: 'CANCELLED',
        cancel_reason: '고객 일정 불가',
      })
      expect(updatePayload.cancelled_at).toBeTruthy()
      expect(updatePayload.updated_at).toBeTruthy()
    })
  })

  describe('action: reschedule', () => {
    it('bookingStartsAt이 비어있으면 422를 반환한다', async () => {
      mockAuth.mockResolvedValueOnce({ workspaceId: 'ws-1', admin: {} })

      const req = new Request('https://example.com/api/workspaces/ws-1/reservations/res-1', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'reschedule', bookingStartsAt: '' }),
      })
      const res = await PATCH(req, {
        params: Promise.resolve({ workspaceId: 'ws-1', reservationId: 'res-1' }),
      })
      expect(res.status).toBe(422)
    })

    it('bookingStartsAt 날짜 형식이 잘못된 경우 400을 반환한다', async () => {
      mockAuth.mockResolvedValueOnce({ workspaceId: 'ws-1', admin: {} })

      const req = new Request('https://example.com/api/workspaces/ws-1/reservations/res-1', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'reschedule', bookingStartsAt: '2026-02-31 14:00' }),
      })
      const res = await PATCH(req, {
        params: Promise.resolve({ workspaceId: 'ws-1', reservationId: 'res-1' }),
      })
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('올바른 예약 일시를 입력해 주세요.')
    })

    it('예약 상태가 CONFIRMED가 아닌 경우 409와 한국어 문구를 반환한다', async () => {
      const mockAdmin = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'res-cancelled',
                  workspace_id: 'ws-1',
                  status: 'CANCELLED',
                  metadata: { bookingStartsAt: '2026-11-10T14:00:00+09:00' },
                },
                error: null,
              }),
            })),
          })),
        })),
      }
      mockAuth.mockResolvedValueOnce({ workspaceId: 'ws-1', admin: mockAdmin })

      const req = new Request('https://example.com/api/workspaces/ws-1/reservations/res-cancelled', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'reschedule', bookingStartsAt: '2026-11-12 15:00' }),
      })
      const res = await PATCH(req, {
        params: Promise.resolve({ workspaceId: 'ws-1', reservationId: 'res-cancelled' }),
      })
      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.error).toBe('확정된 상태의 예약만 일정을 변경할 수 있습니다.')
    })

    it('기존 예약 일시와 동일한 일시로 변경 시도 시 400을 반환한다', async () => {
      const mockAdmin = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'res-same-time',
                  workspace_id: 'ws-1',
                  status: 'CONFIRMED',
                  metadata: { bookingStartsAt: '2026-11-10T14:00:00+09:00' },
                },
                error: null,
              }),
            })),
          })),
        })),
      }
      mockAuth.mockResolvedValueOnce({ workspaceId: 'ws-1', admin: mockAdmin })

      const req = new Request('https://example.com/api/workspaces/ws-1/reservations/res-same-time', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'reschedule', bookingStartsAt: '2026-11-10 14:00' }),
      })
      const res = await PATCH(req, {
        params: Promise.resolve({ workspaceId: 'ws-1', reservationId: 'res-same-time' }),
      })
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('기존 예약 일시와 동일합니다.')
    })

    it('정상 변경 시 bookingStartsAt을 KST로 정규화하여 UPDATE하고 previousBookingStartsAt은 DB 트리거가 기록하므로 애플리케이션에서 중복 기록하지 않는다', async () => {
      let updatePayload: any = null
      const mockUpdate = vi.fn((payload: any) => {
        updatePayload = payload
        return {
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'res-reschedule-ok',
                    workspace_id: 'ws-1',
                    status: 'CONFIRMED',
                    slot_id: 'slot-1',
                    metadata: payload.metadata,
                    updated_at: payload.updated_at,
                  },
                  error: null,
                }),
              })),
            })),
          })),
        }
      })

      const mockAdmin = {
        from: vi.fn((table: string) => {
          if (table === 'reservations') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'res-reschedule-ok',
                      workspace_id: 'ws-1',
                      status: 'CONFIRMED',
                      slot_id: 'slot-1',
                      metadata: {
                        source: 'owner_created',
                        bookingStartsAt: '2026-11-10T14:00:00+09:00',
                      },
                    },
                    error: null,
                  }),
                })),
              })),
              update: mockUpdate,
            }
          }
          return {}
        }),
      }
      mockAuth.mockResolvedValueOnce({ workspaceId: 'ws-1', admin: mockAdmin })

      const req = new Request('https://example.com/api/workspaces/ws-1/reservations/res-reschedule-ok', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'reschedule', bookingStartsAt: '2026-11-15 16:30' }),
      })
      const res = await PATCH(req, {
        params: Promise.resolve({ workspaceId: 'ws-1', reservationId: 'res-reschedule-ok' }),
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(json.status).toBe('rescheduled')
      expect(updatePayload.metadata.bookingStartsAt).toBe('2026-11-15T16:30:00+09:00')
      expect(updatePayload.metadata.source).toBe('owner_created')
      // DB 트리거(20261106090000)가 BEFORE UPDATE에서 이전 시작일시를 NEW.metadata에 주입하므로, 애플리케이션 updatePayload에서는 수동으로 previousBookingStartsAt을 설정하지 않음
      expect(updatePayload.metadata.previousBookingStartsAt).toBeUndefined()
    })
  })

  describe('action: confirm', () => {
    it('예약 상태가 AWAITING_CONFIRMATION이 아니면 409와 한국어 문구를 반환한다', async () => {
      const mockAdmin = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'res-confirmed-already',
                  workspace_id: 'ws-1',
                  status: 'CONFIRMED',
                },
                error: null,
              }),
            })),
          })),
        })),
      }
      mockAuth.mockResolvedValueOnce({ workspaceId: 'ws-1', admin: mockAdmin })

      const req = new Request('https://example.com/api/workspaces/ws-1/reservations/res-confirmed-already', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'confirm' }),
      })
      const res = await PATCH(req, {
        params: Promise.resolve({ workspaceId: 'ws-1', reservationId: 'res-confirmed-already' }),
      })
      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.error).toBe('확정 대기 상태의 예약 신청만 확정할 수 있습니다.')
    })

    it('AWAITING_CONFIRMATION 상태면 reservations UPDATE로 status CONFIRMED, confirmed_at을 설정하고 200을 반환한다', async () => {
      let updatePayload: any = null
      const mockUpdate = vi.fn((payload: any) => {
        updatePayload = payload
        return {
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'res-confirm-ok',
                    workspace_id: 'ws-1',
                    status: 'CONFIRMED',
                    confirmed_at: payload.confirmed_at,
                    updated_at: payload.updated_at,
                  },
                  error: null,
                }),
              })),
            })),
          })),
        }
      })

      const mockAdmin = {
        from: vi.fn((table: string) => {
          if (table === 'reservations') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'res-confirm-ok',
                      workspace_id: 'ws-1',
                      status: 'AWAITING_CONFIRMATION',
                    },
                    error: null,
                  }),
                })),
              })),
              update: mockUpdate,
            }
          }
          return {}
        }),
      }
      mockAuth.mockResolvedValueOnce({ workspaceId: 'ws-1', admin: mockAdmin })

      const req = new Request('https://example.com/api/workspaces/ws-1/reservations/res-confirm-ok', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'confirm' }),
      })
      const res = await PATCH(req, {
        params: Promise.resolve({ workspaceId: 'ws-1', reservationId: 'res-confirm-ok' }),
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(json.status).toBe('confirmed')
      expect(updatePayload.status).toBe('CONFIRMED')
      expect(updatePayload.confirmed_at).toBeTruthy()
      expect(updatePayload.updated_at).toBeTruthy()
    })
  })

  describe('action: decline', () => {
    it('거절 사유가 누락되면 422를 반환한다', async () => {
      mockAuth.mockResolvedValueOnce({ workspaceId: 'ws-1', admin: {} })

      const req = new Request('https://example.com/api/workspaces/ws-1/reservations/res-1', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'decline', reason: '   ' }),
      })
      const res = await PATCH(req, {
        params: Promise.resolve({ workspaceId: 'ws-1', reservationId: 'res-1' }),
      })
      expect(res.status).toBe(422)
    })

    it('예약 상태가 AWAITING_CONFIRMATION이 아니면 409를 반환한다', async () => {
      const mockAdmin = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'res-not-awaiting',
                  workspace_id: 'ws-1',
                  status: 'CONFIRMED',
                },
                error: null,
              }),
            })),
          })),
        })),
      }
      mockAuth.mockResolvedValueOnce({ workspaceId: 'ws-1', admin: mockAdmin })

      const req = new Request('https://example.com/api/workspaces/ws-1/reservations/res-not-awaiting', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'decline', reason: '시간대 마감' }),
      })
      const res = await PATCH(req, {
        params: Promise.resolve({ workspaceId: 'ws-1', reservationId: 'res-not-awaiting' }),
      })
      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.error).toBe('확정 대기 상태의 예약 신청만 거절할 수 있습니다.')
    })

    it('AWAITING_CONFIRMATION 상태면 status CANCELLED, cancel_reason, metadata.requestDeclined=true를 설정하고 200을 반환한다', async () => {
      let updatePayload: any = null
      const mockUpdate = vi.fn((payload: any) => {
        updatePayload = payload
        return {
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'res-decline-ok',
                    workspace_id: 'ws-1',
                    status: 'CANCELLED',
                    cancel_reason: payload.cancel_reason,
                    cancelled_at: payload.cancelled_at,
                    metadata: payload.metadata,
                    updated_at: payload.updated_at,
                  },
                  error: null,
                }),
              })),
            })),
          })),
        }
      })

      const mockAdmin = {
        from: vi.fn((table: string) => {
          if (table === 'reservations') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'res-decline-ok',
                      workspace_id: 'ws-1',
                      status: 'AWAITING_CONFIRMATION',
                      metadata: {
                        channel_source: 'CUSTOMER_REQUEST',
                      },
                    },
                    error: null,
                  }),
                })),
              })),
              update: mockUpdate,
            }
          }
          return {}
        }),
      }
      mockAuth.mockResolvedValueOnce({ workspaceId: 'ws-1', admin: mockAdmin })

      const req = new Request('https://example.com/api/workspaces/ws-1/reservations/res-decline-ok', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'decline', reason: '매장 마감으로 인한 거절' }),
      })
      const res = await PATCH(req, {
        params: Promise.resolve({ workspaceId: 'ws-1', reservationId: 'res-decline-ok' }),
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(json.status).toBe('declined')
      expect(updatePayload.status).toBe('CANCELLED')
      expect(updatePayload.cancel_reason).toBe('매장 마감으로 인한 거절')
      expect(updatePayload.cancelled_at).toBeTruthy()
      expect(updatePayload.metadata).toEqual({
        channel_source: 'CUSTOMER_REQUEST',
        requestDeclined: true,
      })
    })
  })
})
