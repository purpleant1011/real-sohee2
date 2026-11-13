import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  from: vi.fn(),
  profileUpdate: vi.fn(),
  profileEq: vi.fn(),
  profileSelect: vi.fn(),
  profileMaybeSingle: vi.fn(),
  insert: vi.fn(),
  memberUpdate: vi.fn(),
  memberEq: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/features/auth/current-workspace', () => ({
  getCurrentWorkspaceContext: mocks.workspace,
}))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: mocks.from,
  })),
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { saveSettingsAction } from './save-settings'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const memberId = '10000000-0000-4000-8000-000000000001'

describe('saveSettingsAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workspace.mockResolvedValue({ workspaceId, role: 'owner' })
    mocks.profileMaybeSingle.mockResolvedValue({ data: { workspace_id: workspaceId }, error: null })
    mocks.profileSelect.mockReturnValue({ maybeSingle: mocks.profileMaybeSingle })
    mocks.profileEq.mockReturnValue({ select: mocks.profileSelect })
    mocks.profileUpdate.mockReturnValue({ eq: mocks.profileEq })
    mocks.insert.mockResolvedValue({ error: null })
    mocks.memberEq.mockResolvedValue({ error: null })
    mocks.memberUpdate.mockReturnValue({ eq: vi.fn(() => ({ eq: mocks.memberEq })) })
    mocks.from.mockImplementation((table: string) => table === 'workspace_members'
      ? { update: mocks.memberUpdate }
      : { update: mocks.profileUpdate, insert: mocks.insert })
  })

  it('resolves the workspace on the server and saves only allowed business fields', async () => {
    await expect(saveSettingsAction({
      kind: 'business',
      businessName: '  소희 카페  ',
      industry: ' 카페 ',
      location: ' 서울 ',
      summary: ' 운영 요약 ',
    })).resolves.toEqual({ ok: true, message: '사업 정보를 저장했어요.' })

    expect(mocks.profileUpdate).toHaveBeenCalledWith({
      business_name: '소희 카페',
      industry: '카페',
      location: '서울',
      summary: '운영 요약',
    })
    expect(mocks.profileEq).toHaveBeenCalledWith('workspace_id', workspaceId)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/settings/business')
  })

  it('inserts a business profile when the scoped update finds no existing row', async () => {
    mocks.profileMaybeSingle.mockResolvedValue({ data: null, error: null })

    await expect(saveSettingsAction({
      kind: 'business',
      businessName: '소희 카페',
      industry: '',
      location: '',
      summary: '',
    })).resolves.toEqual({ ok: true, message: '사업 정보를 저장했어요.' })

    expect(mocks.insert).toHaveBeenCalledWith({
      workspace_id: workspaceId,
      business_name: '소희 카페',
      industry: null,
      location: null,
      summary: null,
    })
  })

  it('rejects an empty name and a too-long summary before touching Supabase', async () => {
    const result = await saveSettingsAction({
      kind: 'business',
      businessName: ' ',
      industry: '',
      location: '',
      summary: '가'.repeat(4_001),
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { businessName: expect.any(Array), summary: expect.any(Array) },
    })
    expect(mocks.profileUpdate).not.toHaveBeenCalled()
  })

  it('rejects an invalid channel status before touching Supabase', async () => {
    const result = await saveSettingsAction({
      kind: 'channel',
      channel: 'instagram',
      status: 'pretend-connected',
      accountLabel: '@unsafe',
    })

    expect(result).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(mocks.profileUpdate).not.toHaveBeenCalled()
  })

  it('returns a safe forbidden result for a viewer', async () => {
    mocks.workspace.mockResolvedValue({ workspaceId, role: 'viewer' })

    await expect(saveSettingsAction({
      kind: 'brand',
      voice: '차분하게',
      keywords: '안전, 운영',
      prohibitedTerms: '과장',
    })).resolves.toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: '이 설정을 변경할 권한이 없어요.',
    })
    expect(mocks.profileUpdate).not.toHaveBeenCalled()
  })

  it('allows only the owner to update an existing workspace member', async () => {
    await expect(saveSettingsAction({
      kind: 'member',
      memberId,
      role: 'reviewer',
      status: 'active',
    })).resolves.toEqual({ ok: true, message: '멤버 권한을 저장했어요.' })

    expect(mocks.memberUpdate).toHaveBeenCalledWith({ role: 'reviewer', status: 'active' })
    expect(mocks.memberEq).toHaveBeenCalledWith('user_id', memberId)

    mocks.workspace.mockResolvedValue({ workspaceId, role: 'manager' })
    await expect(saveSettingsAction({
      kind: 'member',
      memberId,
      role: 'viewer',
      status: 'disabled',
    })).resolves.toMatchObject({ ok: false, code: 'FORBIDDEN' })
  })

  it('does not accept a caller-supplied workspace identifier', async () => {
    const result = await saveSettingsAction({
      kind: 'business',
      workspaceId: '20000000-0000-4000-8000-000000000099',
      businessName: '다른 회사',
      industry: '',
      location: '',
      summary: '',
    })

    expect(result).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(mocks.profileUpdate).not.toHaveBeenCalled()
  })
})
