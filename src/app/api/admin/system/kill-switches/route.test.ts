import { describe, expect, it, vi } from 'vitest'
import { GET } from './route'
import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator'
import { createServerSupabaseClient } from '@/lib/supabase/server'

vi.mock('@/features/operator-auth/require-operator', () => ({ requireOperatorAnyScope: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }))

describe('kill-switches GET', () => {
  it('조회 오류를 빈 목록 성공으로 숨기지 않는다', async () => {
    vi.mocked(requireOperatorAnyScope).mockResolvedValue({} as never)
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      from: () => ({ select: () => ({ order: async () => ({ data: null, error: { message: 'timeout' } }) }) }),
    } as never)
    const res = await GET()
    expect(res.status).toBe(503)
    expect((await res.json()).success).not.toBe(true)
  })
})
