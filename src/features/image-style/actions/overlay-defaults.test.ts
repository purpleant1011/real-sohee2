// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../server/manager-auth', () => ({
  authorizeManager: mocks.authorize,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    rpc: mocks.rpc,
  })),
}))

import { saveOverlayDefaultsAction } from './overlay-defaults'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const userId = '10000000-0000-4000-8000-000000000001'

describe('saveOverlayDefaultsAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue({ userId, role: 'owner' })
    mocks.rpc.mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { version: 1 }, error: null }),
    })
  })

  it('rejects invalid inputs', async () => {
    const invalidId = await saveOverlayDefaultsAction({
      workspaceId: 'invalid-uuid',
      preset: 'portrait-left',
      texts: { brandLine: '', designLine: '', quote: '', insetLabel: '' },
    })
    expect(invalidId.error?.message).toBe('입력 내용을 확인해 주세요.')

    const invalidPreset = await saveOverlayDefaultsAction({
      workspaceId,
      preset: 'invalid-preset',
      texts: { brandLine: '', designLine: '', quote: '', insetLabel: '' },
    })
    expect(invalidPreset.error?.message).toBe('입력 내용을 확인해 주세요.')

    const missingTexts = await saveOverlayDefaultsAction({
      workspaceId,
      preset: 'portrait-left',
      texts: { brandLine: '' },
    })
    expect(missingTexts.error?.message).toBe('입력 내용을 확인해 주세요.')

    const tooLongText = await saveOverlayDefaultsAction({
      workspaceId,
      preset: 'portrait-left',
      texts: {
        brandLine: 'A'.repeat(201),
        designLine: '',
        quote: '',
        insetLabel: '',
      },
    })
    expect(tooLongText.error?.message).toBe('입력 내용을 확인해 주세요.')
  })

  it('rejects unauthorized users with the auth message', async () => {
    mocks.authorize.mockResolvedValueOnce({ message: '소유자 또는 관리자만 이미지 스타일을 만들 수 있어요.' })

    const result = await saveOverlayDefaultsAction({
      workspaceId,
      preset: 'portrait-left',
      texts: { brandLine: '우리 가게', designLine: '대표 메뉴', quote: '', insetLabel: 'BEFORE' },
    })
    expect(result).toEqual({
      error: {
        message: '소유자 또는 관리자만 이미지 스타일을 만들 수 있어요.',
        requestId: 'overlay-defaults',
      },
    })
  })

  it('normalizes texts and calls activate_harness_rule_version rpc with required params', async () => {
    const singleMock = vi.fn().mockResolvedValue({ data: { version: 2 }, error: null })
    mocks.rpc.mockReturnValueOnce({ single: singleMock })

    const result = await saveOverlayDefaultsAction({
      workspaceId,
      preset: 'portrait-right',
      texts: {
        brandLine: '   브랜드 타이틀   ',
        designLine: '   소제목   ',
        quote: '첫 번째 줄\n두 번째 줄\n세 번째 줄\n네 번째 줄\n다섯 번째 줄은 제외',
        insetLabel: '   ',
      },
    })

    expect(result).toEqual({ data: { saved: true } })
    expect(mocks.rpc).toHaveBeenCalledWith('activate_harness_rule_version', {
      p_workspace_id: workspaceId,
      p_rule_key: 'custom-overlay-v1',
      p_rule_type: 'image_generation',
      p_title: '문구·삽입컷 기본값',
      p_description: '문구 합성 기본값',
      p_structured_rule: {
        overlay: {
          preset: 'portrait-right',
          texts: {
            brandLine: '브랜드 타이틀',
            designLine: '소제목',
            quote: '첫 번째 줄\n두 번째 줄\n세 번째 줄\n네 번째 줄',
            insetLabel: 'BEFORE',
          },
        },
      },
      p_applies_to_channels: ['instagram', 'threads', 'naver_blog'],
      p_created_by_user_id: userId,
      p_approved_by_user_id: userId,
      p_source_knowledge_fact_ids: [],
    })
  })

  it('returns failure message when RPC returns error', async () => {
    mocks.rpc.mockReturnValueOnce({
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'database rpc error' } }),
    })

    const result = await saveOverlayDefaultsAction({
      workspaceId,
      preset: 'portrait-left',
      texts: { brandLine: 'A', designLine: 'B', quote: '', insetLabel: 'BEFORE' },
    })

    expect(result).toEqual({
      error: {
        message: '기본 문구를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
        requestId: 'overlay-defaults',
      },
    })
  })
})
