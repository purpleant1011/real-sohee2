import { describe, expect, it, vi } from 'vitest'
import {
  createSupabaseOutboxPorts,
  type SupabaseOutboxClient,
} from './supabase-outbox-ports'

describe('createSupabaseOutboxPorts', () => {
  describe('rpcClient', () => {
    it('client.rpc를 호출하고 성공 결과를 반환한다', async () => {
      const mockRpc = vi.fn().mockResolvedValue({ data: true, error: null })
      const mockClient = {
        rpc: mockRpc,
        from: vi.fn(),
      } as unknown as SupabaseOutboxClient

      const ports = createSupabaseOutboxPorts(mockClient)
      const res = await ports.rpcClient.rpc('claim_kakao_notification_job', {
        p_job_id: 'job-1',
      })

      expect(res).toEqual({ data: true, error: null })
      expect(mockRpc).toHaveBeenCalledWith('claim_kakao_notification_job', {
        p_job_id: 'job-1',
      })
    })

    it('provider에러메시지정적은닉: client.rpc가 에러를 반환하면 내부 메시지를 은닉하고 정적 에러 객체를 반환한다', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: {
          message: 'Postgres internal error: secret_key leaked 010-1234-5678',
          code: 'P0001',
          details: 'table kakao_notification_outbox constraint failed',
        },
      })
      const mockClient = {
        rpc: mockRpc,
        from: vi.fn(),
      } as unknown as SupabaseOutboxClient

      const ports = createSupabaseOutboxPorts(mockClient)
      const res = await ports.rpcClient.rpc('claim_kakao_notification_job', {
        p_job_id: 'job-1',
      })

      expect(res.data).toBeNull()
      expect(res.error).not.toBeNull()
      expect(res.error?.message).toBe('Outbox RPC execution failed')
      expect(JSON.stringify(res.error)).not.toContain('secret_key')
      expect(JSON.stringify(res.error)).not.toContain('010-1234-5678')
    })

    it('provider에러메시지정적은닉: client.rpc 호출 중 예외(throw)가 발생해도 정적 에러 객체를 반환한다', async () => {
      const mockRpc = vi.fn().mockRejectedValue(
        new Error('Network drop with canary token secret-token-xyz')
      )
      const mockClient = {
        rpc: mockRpc,
        from: vi.fn(),
      } as unknown as SupabaseOutboxClient

      const ports = createSupabaseOutboxPorts(mockClient)
      const res = await ports.rpcClient.rpc('claim_kakao_notification_job', {})

      expect(res.data).toBeNull()
      expect(res.error?.message).toBe('Outbox RPC execution failed')
      expect(JSON.stringify(res.error)).not.toContain('secret-token-xyz')
    })
  })

  describe('reservationReader', () => {
    it('필요 필드만을 select하고 eq workspace_id 및 id로 maybeSingle을 조회한다 (customer_phone 포함, 독립 phone 컬럼 제외)', async () => {
      const dbRow = {
        id: 'res-123',
        workspace_id: 'ws-456',
        status: 'CONFIRMED',
        customer_id: 'cust-789',
        customer_name: '홍길동',
        customer_phone: '010-1234-5678',
        service_name: '네일 케어',
        metadata: { bookingStartsAt: '2026-11-07T10:00:00.000Z' },
        updated_at: '2026-11-06T10:00:00.999888+00:00',
      }

      const resSelectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: dbRow, error: null }),
          }),
        }),
      })

      const bpSelectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { business_name: '정규 뷰티샵', location: '서울 강남구 테헤란로 123' },
            error: null,
          }),
        }),
      })

      const fromMock = vi.fn().mockImplementation((table: string) => {
        if (table === 'reservations') {
          return { select: resSelectMock }
        }
        if (table === 'business_profiles') {
          return { select: bpSelectMock }
        }
        throw new Error(`Unexpected table: ${table}`)
      })

      const mockClient = {
        rpc: vi.fn(),
        from: fromMock,
      } as unknown as SupabaseOutboxClient

      const ports = createSupabaseOutboxPorts(mockClient)
      const row = await ports.reservationReader({
        workspaceId: 'ws-456',
        reservationId: 'res-123',
      })

      expect(fromMock).toHaveBeenCalledWith('reservations')
      expect(fromMock).toHaveBeenCalledWith('business_profiles')

      const selectCols = resSelectMock.mock.calls[0][0] as string
      expect(selectCols).toBe(
        'id, workspace_id, status, customer_id, customer_name, customer_phone, service_name, cancel_reason, metadata, updated_at'
      )
      // 실제 reservations 테이블에 존재하는 컬럼만 조회하며, cancel_reason을 포함하고 독립 'phone' 컬럼은 제외(42703 방지)
      const colList = selectCols.split(',').map((c) => c.trim())
      expect(colList).toContain('customer_phone')
      expect(colList).toContain('cancel_reason')
      expect(colList).not.toContain('phone')

      const bpSelectCols = bpSelectMock.mock.calls[0][0] as string
      expect(bpSelectCols).toBe('business_name, location')

      expect(row?.id).toBe('res-123')
      expect(row?.updated_at).toBe('2026-11-06T10:00:00.999888+00:00')
      // business_profiles 정규 원천 값 병합 검증
      expect(row?.metadata?.shopName).toBe('정규 뷰티샵')
      expect(row?.metadata?.locationText).toBe('서울 강남구 테헤란로 123')
    })

    it('business_profiles 정규 원천 조회를 통해 untrusted metadata.shopName을 canonical 값으로 덮어쓴다', async () => {
      const dbRowWithUntrustedMeta = {
        id: 'res-123',
        workspace_id: 'ws-456',
        status: 'CONFIRMED',
        customer_id: 'cust-789',
        customer_name: '홍길동',
        customer_phone: '010-1234-5678',
        service_name: '속눈썹 펌',
        metadata: {
          bookingStartsAt: '2026-11-07T10:00:00.000Z',
          shopName: '조작된 가짜 샵이름',
          locationText: '조작된 가짜 위치정보',
        },
        updated_at: '2026-11-06T10:00:00.000Z',
      }

      const mockClient = {
        rpc: vi.fn(),
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'reservations') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: dbRowWithUntrustedMeta, error: null }),
                  }),
                }),
              }),
            }
          }
          if (table === 'business_profiles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { business_name: '진짜 소희 뷰티랩', location: '서울 마포구 양화로 45' },
                    error: null,
                  }),
                }),
              }),
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
      } as unknown as SupabaseOutboxClient

      const ports = createSupabaseOutboxPorts(mockClient)
      const row = await ports.reservationReader({
        workspaceId: 'ws-456',
        reservationId: 'res-123',
      })

      expect(row?.metadata?.shopName).toBe('진짜 소희 뷰티랩')
      expect(row?.metadata?.locationText).toBe('서울 마포구 양화로 45')
      expect(row?.metadata?.shopName).not.toBe('조작된 가짜 샵이름')
    })

    it('business_profiles가 없거나 blank면 가짜 default를 채우지 않고 shopName/locationText를 비워 sender 차단을 유도한다', async () => {
      const dbRow = {
        id: 'res-123',
        workspace_id: 'ws-456',
        status: 'CONFIRMED',
        customer_id: 'cust-789',
        customer_name: '홍길동',
        customer_phone: '010-1234-5678',
        service_name: '속눈썹 펌',
        metadata: {
          bookingStartsAt: '2026-11-07T10:00:00.000Z',
          shopName: '기존 신뢰불가 샵',
        },
        updated_at: '2026-11-06T10:00:00.000Z',
      }

      const mockClient = {
        rpc: vi.fn(),
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'reservations') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: dbRow, error: null }),
                  }),
                }),
              }),
            }
          }
          if (table === 'business_profiles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { business_name: '   ', location: null },
                    error: null,
                  }),
                }),
              }),
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
      } as unknown as SupabaseOutboxClient

      const ports = createSupabaseOutboxPorts(mockClient)
      const row = await ports.reservationReader({
        workspaceId: 'ws-456',
        reservationId: 'res-123',
      })

      // profile이 blank이므로 가짜 기본값이나 기존 untrusted 값을 넣지 않고 undefined로 유지
      expect(row?.metadata?.shopName).toBeUndefined()
      expect(row?.metadata?.locationText).toBeUndefined()
    })

    it('payment_captures LIVE 건이 있으면 payment_amount_krw를 채운다', async () => {
      const dbRow = {
        id: 'res-123',
        workspace_id: 'ws-456',
        status: 'CONFIRMED',
        customer_phone: '010-1234-5678',
        updated_at: '2026-11-06T10:00:00.000Z',
      }

      const mockClient = {
        rpc: vi.fn(),
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'reservations') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: dbRow, error: null }),
                  }),
                }),
              }),
            }
          }
          if (table === 'business_profiles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { business_name: '테스트 샵', location: '서울' },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table === 'deposit_intents') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({
                    data: [{ id: 'intent-uuid-1' }],
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table === 'payment_captures') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    in: vi.fn().mockReturnValue({
                      order: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                          maybeSingle: vi.fn().mockResolvedValue({
                            data: { amount_krw: 50000 },
                            error: null,
                          }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
      } as unknown as SupabaseOutboxClient

      const ports = createSupabaseOutboxPorts(mockClient)
      const row = await ports.reservationReader({
        workspaceId: 'ws-456',
        reservationId: 'res-123',
        event: 'PAYMENT_CONFIRMED',
      })

      expect(row?.payment_amount_krw).toBe(50000)
    })

    it('business_profiles 쿼리 에러 시 정적 generic error를 throw한다', async () => {
      const dbRow = {
        id: 'res-123',
        workspace_id: 'ws-456',
        status: 'CONFIRMED',
        customer_phone: '010-1234-5678',
        updated_at: '2026-11-06T10:00:00.000Z',
      }

      const mockClient = {
        rpc: vi.fn(),
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'reservations') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: dbRow, error: null }),
                  }),
                }),
              }),
            }
          }
          if (table === 'business_profiles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'Database query timeout on business_profiles' },
                  }),
                }),
              }),
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
      } as unknown as SupabaseOutboxClient

      const ports = createSupabaseOutboxPorts(mockClient)
      await expect(
        ports.reservationReader({ workspaceId: 'ws-456', reservationId: 'res-123' })
      ).rejects.toThrow('RESERVATION_READ_FAILED')
    })

    it('provider에러메시지정적은닉: DB 에러 발생 시 원문 유출 없이 정적 generic error를 throw한다', async () => {
      const maybeSingleMock = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database connection failed with sensitive password' },
      })
      const mockClient = {
        rpc: vi.fn(),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: maybeSingleMock,
              }),
            }),
          }),
        }),
      } as unknown as SupabaseOutboxClient

      const ports = createSupabaseOutboxPorts(mockClient)

      await expect(
        ports.reservationReader({ workspaceId: 'ws-1', reservationId: 'res-1' })
      ).rejects.toThrow('RESERVATION_READ_FAILED')

      try {
        await ports.reservationReader({ workspaceId: 'ws-1', reservationId: 'res-1' })
      } catch (err: unknown) {
        const error = err as Error
        expect(error.message).toBe('RESERVATION_READ_FAILED')
        expect(String(error.cause ?? '')).not.toContain('sensitive password')
      }
    })
  })

  describe('source.listDueJobs', () => {
    it('limit 1~50 범위를 검증한다', async () => {
      const mockClient = { rpc: vi.fn(), from: vi.fn() } as any
      const ports = createSupabaseOutboxPorts(mockClient)
      const now = new Date('2026-11-06T10:00:00.000Z')

      await expect(ports.source.listDueJobs(0, now)).rejects.toThrow('INVALID_LIMIT')
      await expect(ports.source.listDueJobs(51, now)).rejects.toThrow('INVALID_LIMIT')
      await expect(ports.source.listDueJobs(-5, now)).rejects.toThrow('INVALID_LIMIT')
      await expect(ports.source.listDueJobs(2.5, now)).rejects.toThrow('INVALID_LIMIT')
    })

    it('microseconds유지테스트: READY 및 만료 CLAIMED 건을 조회하여 마이크로초 절삭 없이 Job[]으로 반환한다', async () => {
      const rawRows = [
        {
          id: 'job-1',
          workspace_id: 'ws-1',
          reservation_id: 'res-1',
          reservation_updated_at: '2026-11-06T10:00:00.123456+00:00',
          event: 'BOOKING_CONFIRMED',
          due_at: '2026-11-06T09:59:59.654321+00:00',
          status: 'READY',
          lease_until: null,
        },
        {
          id: 'job-2',
          workspace_id: 'ws-1',
          reservation_id: 'res-2',
          reservation_updated_at: '2026-11-06T10:00:00.789123+00:00',
          event: 'BOOKING_CHANGED',
          due_at: '2026-11-06T09:55:00.000000+00:00',
          status: 'CLAIMED',
          lease_until: '2026-11-06T09:58:00.000000+00:00',
        },
      ]

      const limitMock = vi.fn().mockResolvedValue({ data: rawRows, error: null })
      const orderMock = vi.fn().mockReturnValue({ limit: limitMock })
      const orMock = vi.fn().mockReturnValue({ order: orderMock })
      const selectMock = vi.fn().mockReturnValue({ or: orMock })
      const fromMock = vi.fn().mockReturnValue({ select: selectMock })

      const mockClient = { rpc: vi.fn(), from: fromMock } as any
      const ports = createSupabaseOutboxPorts(mockClient)
      const now = new Date('2026-11-06T10:00:00.000Z')

      const jobs = await ports.source.listDueJobs(10, now)

      expect(fromMock).toHaveBeenCalledWith('kakao_notification_outbox')
      expect(selectMock).toHaveBeenCalledWith(
        'id, workspace_id, reservation_id, reservation_updated_at, event, due_at, status, lease_until'
      )
      expect(orMock).toHaveBeenCalledWith(
        'and(status.eq.READY,due_at.lte.2026-11-06T10:00:00.000Z),and(status.eq.CLAIMED,lease_until.lte.2026-11-06T10:00:00.000Z)'
      )
      expect(orderMock).toHaveBeenCalledWith('due_at', { ascending: true })
      expect(limitMock).toHaveBeenCalledWith(10)

      expect(jobs).toHaveLength(2)
      // microseconds raw string 유지 검증
      expect(jobs[0].reservationUpdatedAt).toBe('2026-11-06T10:00:00.123456+00:00')
      expect(jobs[0].dueAt).toBe('2026-11-06T09:59:59.654321+00:00')
      expect(jobs[1].reservationUpdatedAt).toBe('2026-11-06T10:00:00.789123+00:00')
    })

    it('event 화이트리스트 외 이벤트가 포함되면 임의 캐스팅하지 않고 generic error를 throw한다', async () => {
      const invalidRow = {
        id: 'job-x',
        workspace_id: 'ws-1',
        reservation_id: 'res-1',
        reservation_updated_at: '2026-11-06T10:00:00.000Z',
        event: 'UNKNOWN_ATTACK_EVENT',
        due_at: '2026-11-06T10:00:00.000Z',
        status: 'READY',
      }

      const mockClient = {
        rpc: vi.fn(),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            or: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [invalidRow], error: null }),
              }),
            }),
          }),
        }),
      } as unknown as SupabaseOutboxClient

      const ports = createSupabaseOutboxPorts(mockClient)
      await expect(
        ports.source.listDueJobs(10, new Date('2026-11-06T10:00:00.000Z'))
      ).rejects.toThrow('INVALID_OUTBOX_ROW')
    })

    it('REMINDER_24H 및 REMINDER_2H 이벤트를 허용 화이트리스트로 정상 파싱한다', async () => {
      const reminderRows = [
        {
          id: 'job-r24',
          workspace_id: 'ws-1',
          reservation_id: 'res-1',
          reservation_updated_at: '2026-11-06T10:00:00.000Z',
          event: 'REMINDER_24H',
          due_at: '2026-11-06T12:00:00.000Z',
          status: 'READY',
          lease_until: null,
        },
        {
          id: 'job-r2',
          workspace_id: 'ws-1',
          reservation_id: 'res-1',
          reservation_updated_at: '2026-11-06T10:00:00.000Z',
          event: 'REMINDER_2H',
          due_at: '2026-11-07T08:00:00.000Z',
          status: 'READY',
          lease_until: null,
        },
      ]

      const mockClient = {
        rpc: vi.fn(),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            or: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: reminderRows, error: null }),
              }),
            }),
          }),
        }),
      } as unknown as SupabaseOutboxClient

      const ports = createSupabaseOutboxPorts(mockClient)
      const jobs = await ports.source.listDueJobs(10, new Date('2026-11-07T10:00:00.000Z'))

      expect(jobs).toHaveLength(2)
      expect(jobs[0].event).toBe('REMINDER_24H')
      expect(jobs[1].event).toBe('REMINDER_2H')
    })

    it('PAYMENT_CONFIRMED 이벤트를 허용 화이트리스트로 정상 파싱한다', async () => {
      const paymentRow = {
        id: 'job-pay-1',
        workspace_id: 'ws-1',
        reservation_id: 'res-1',
        reservation_updated_at: '2026-11-06T10:00:00.000Z',
        event: 'PAYMENT_CONFIRMED',
        due_at: '2026-11-06T10:00:00.000Z',
        status: 'READY',
        lease_until: null,
      }

      const mockClient = {
        rpc: vi.fn(),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            or: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [paymentRow], error: null }),
              }),
            }),
          }),
        }),
      } as unknown as SupabaseOutboxClient

      const ports = createSupabaseOutboxPorts(mockClient)
      const jobs = await ports.source.listDueJobs(10, new Date('2026-11-06T10:00:00.000Z'))

      expect(jobs).toHaveLength(1)
      expect(jobs[0].event).toBe('PAYMENT_CONFIRMED')
    })

    it('필드 누락 또는 타입 오류가 포함되면 임의 캐스팅하지 않고 generic error를 throw한다', async () => {
      const malformedRow = {
        id: 'job-x',
        // workspace_id 누락
        reservation_id: 'res-1',
        event: 'BOOKING_CONFIRMED',
      }

      const mockClient = {
        rpc: vi.fn(),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            or: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [malformedRow], error: null }),
              }),
            }),
          }),
        }),
      } as unknown as SupabaseOutboxClient

      const ports = createSupabaseOutboxPorts(mockClient)
      await expect(
        ports.source.listDueJobs(10, new Date('2026-11-06T10:00:00.000Z'))
      ).rejects.toThrow('INVALID_OUTBOX_ROW')
    })
  })

  describe('source.expireSending', () => {
    it('rpc expire_kakao_notification_jobs를 호출하고 정상 0 이상 정수를 반환한다', async () => {
      const mockRpc = vi.fn().mockResolvedValue({ data: 3, error: null })
      const mockClient = { rpc: mockRpc, from: vi.fn() } as any

      const ports = createSupabaseOutboxPorts(mockClient)
      const count = await ports.source.expireSending()

      expect(count).toBe(3)
      expect(mockRpc).toHaveBeenCalledWith('expire_kakao_notification_jobs')
    })

    it('반환값이 음수이거나 비정수이면 generic error를 throw한다', async () => {
      const mockRpcNegative = vi.fn().mockResolvedValue({ data: -1, error: null })
      const portsNeg = createSupabaseOutboxPorts({ rpc: mockRpcNegative, from: vi.fn() } as unknown as SupabaseOutboxClient)
      await expect(portsNeg.source.expireSending()).rejects.toThrow('EXPIRE_SENDING_FAILED')

      const mockRpcFloat = vi.fn().mockResolvedValue({ data: 1.5, error: null })
      const portsFloat = createSupabaseOutboxPorts({ rpc: mockRpcFloat, from: vi.fn() } as unknown as SupabaseOutboxClient)
      await expect(portsFloat.source.expireSending()).rejects.toThrow('EXPIRE_SENDING_FAILED')
    })

    it('provider에러메시지정적은닉: RPC 에러 발생 시 원문 유출 없이 정적 generic error를 throw한다', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'internal table lock timeout table_secret_info' },
      })
      const mockClient = { rpc: mockRpc, from: vi.fn() } as unknown as SupabaseOutboxClient
      const ports = createSupabaseOutboxPorts(mockClient)

      await expect(ports.source.expireSending()).rejects.toThrow('EXPIRE_SENDING_FAILED')

      try {
        await ports.source.expireSending()
      } catch (err: unknown) {
        const error = err as Error
        expect(error.message).toBe('EXPIRE_SENDING_FAILED')
        expect(String(error.cause ?? '')).not.toContain('table_secret_info')
      }
    })
  })

  describe('this 바인딩 보존 검증', () => {
    it('client.rpc 및 client.from 호출 시 this 바인딩이 누락되지 않고 유지된다', async () => {
      const clientWithThis = {
        secretContext: 'CLIENT_INSTANCE_CONTEXT',
        rpc: function (this: { secretContext: string }, fn: string) {
          if (!this || this.secretContext !== 'CLIENT_INSTANCE_CONTEXT') {
            throw new Error('UNBOUND_RPC_THIS')
          }
          if (fn === 'expire_kakao_notification_jobs') {
            return Promise.resolve({ data: 0, error: null })
          }
          return Promise.resolve({ data: true, error: null })
        },
        from: function (this: { secretContext: string }, table: string) {
          if (!this || this.secretContext !== 'CLIENT_INSTANCE_CONTEXT' || !table) {
            throw new Error('UNBOUND_FROM_THIS')
          }
          const makeEqChain = () => {
            const chain: any = {
              eq: vi.fn().mockImplementation(() => chain),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'res-1',
                  workspace_id: 'ws-1',
                  status: 'CONFIRMED',
                  business_name: '바운드 뷰티샵',
                  location: '바운드 주소',
                  updated_at: '2026-11-06T10:00:00.000Z',
                },
                error: null,
              }),
            }
            return chain
          }
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation(makeEqChain),
              or: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }
        },
      } as unknown as SupabaseOutboxClient

      const ports = createSupabaseOutboxPorts(clientWithThis)

      // 1. rpcClient.rpc 호출 시 this 검증
      const rpcResult = await ports.rpcClient.rpc('claim_kakao_notification_job', {})
      expect(rpcResult.error).toBeNull()
      expect(rpcResult.data).toBe(true)

      // 2. reservationReader 호출 시 this 검증
      const row = await ports.reservationReader({ workspaceId: 'ws-1', reservationId: 'res-1' })
      expect(row?.id).toBe('res-1')

      // 3. source.listDueJobs 호출 시 this 검증
      const jobs = await ports.source.listDueJobs(5, new Date('2026-11-06T10:00:00.000Z'))
      expect(jobs).toEqual([])

      // 4. source.expireSending 호출 시 this 검증
      const expiredCount = await ports.source.expireSending()
      expect(expiredCount).toBe(0)
    })
  })
})
