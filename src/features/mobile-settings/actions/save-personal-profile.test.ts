import { describe, expect, it, vi, beforeEach } from 'vitest'
import { savePersonalProfileAction } from './save-personal-profile'

const mockGetClaims = vi.fn()
const mockSelect = vi.fn()
const mockUpdate = vi.fn()
const mockInsert = vi.fn()
const mockEq = vi.fn()
const mockMaybeSingle = vi.fn()
const mockRevalidatePath = vi.fn()

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      getClaims: mockGetClaims,
    },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          update: mockUpdate.mockReturnValue({
            eq: mockEq.mockReturnValue({
              select: mockSelect.mockReturnValue({
                maybeSingle: mockMaybeSingle,
              }),
            }),
          }),
          insert: mockInsert,
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  })),
}))

describe('savePersonalProfileAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('인증되지 않은 세션이면 UNAUTHORIZED 에러를 반환한다', async () => {
    mockGetClaims.mockResolvedValue({ data: null, error: new Error('No session') })

    const result = await savePersonalProfileAction({ displayName: '소희대표' })

    expect(result).toEqual({
      ok: false,
      code: 'UNAUTHORIZED',
      message: '로그인 정보를 확인할 수 없어요. 다시 로그인해 주세요.',
    })
  })

  it('빈 문자열이나 공백만 있는 이름은 INVALID_INPUT 에러를 반환한다', async () => {
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: 'user-123' } },
      error: null,
    })

    const result = await savePersonalProfileAction({ displayName: '   ' })

    expect(result).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
      message: '표시 이름을 1자 이상 80자 이하로 입력해 주세요.',
    })
  })

  it('80자를 초과하는 이름은 INVALID_INPUT 에러를 반환한다', async () => {
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: 'user-123' } },
      error: null,
    })

    const longName = '가'.repeat(81)
    const result = await savePersonalProfileAction({ displayName: longName })

    expect(result).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
      message: '표시 이름을 1자 이상 80자 이하로 입력해 주세요.',
    })
  })

  it('유효한 표시 이름이면 profiles 테이블을 업데이트하고 경로를 재검증한다', async () => {
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: 'user-123' } },
      error: null,
    })
    mockMaybeSingle.mockResolvedValue({
      data: { id: 'user-123', display_name: '정직한사장님' },
      error: null,
    })

    const result = await savePersonalProfileAction({ displayName: '  정직한사장님  ' })

    expect(result).toEqual({
      ok: true,
      message: '표시 이름을 저장했어요.',
      displayName: '정직한사장님',
    })
    expect(mockUpdate).toHaveBeenCalledWith({
      display_name: '정직한사장님',
    })
    // updated_at은 DB 트리거가 갱신하며 authenticated 롤 컬럼 grant에서 제외되어 있으므로 update payload에 포함되지 않아야 함
    expect(mockUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ updated_at: expect.anything() }),
    )
    expect(mockEq).toHaveBeenCalledWith('id', 'user-123')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/app/system/privacy')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/app', 'layout')
  })

  it('기존 profiles 레코드가 없으면 insert를 시도한다', async () => {
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: 'user-456' } },
      error: null,
    })
    // update returns null existing row
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: null,
    })
    mockInsert.mockResolvedValue({
      error: null,
    })

    const result = await savePersonalProfileAction({ displayName: '새사장님' })

    expect(result).toEqual({
      ok: true,
      message: '표시 이름을 저장했어요.',
      displayName: '새사장님',
    })
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'user-456',
        display_name: '새사장님',
      }),
    )
  })
})
