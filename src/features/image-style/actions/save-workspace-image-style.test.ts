import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  membership: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  rpcArgs: vi.fn(),
  ownedRefs: vi.fn(),
  mediaEq: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: () => { const q: Record<string, unknown> = {}; q.select = () => q; q.eq = () => q; q.maybeSingle = mocks.membership; return q },
  })),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({
    rpc: (_name: string, args: unknown) => { mocks.rpcArgs(args); return { single: mocks.rpc } },
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.eq = (col: string, val: unknown) => {
        if (table === 'media_assets') mocks.mediaEq(col, val)
        return q
      }
      q.in = () => mocks.ownedRefs()
      return q
    },
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { saveWorkspaceImageStyleAction } from './save-workspace-image-style'

const input = {
  workspaceId: '20000000-0000-4000-8000-000000000001',
  subject: '네일 아트', mood: '', setting: '', lookAndColor: '', people: 'hands', avoid: '네온', extra: '',
}

describe('saveWorkspaceImageStyleAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: { id: '10000000-0000-4000-8000-000000000001' } }, error: null })
    mocks.membership.mockResolvedValue({ data: { role: 'owner', status: 'active' }, error: null })
    mocks.rpc.mockResolvedValue({ data: { id: 'r1', version: 2 }, error: null })
    mocks.ownedRefs.mockResolvedValue({ data: [], error: null })
  })

  it('saves for an owner and refreshes the settings page', async () => {
    await expect(saveWorkspaceImageStyleAction(input)).resolves.toEqual({ data: { version: 2 } })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/account/knowledge')
  })

  it('rejects viewers, empty styles and anonymous users without writing', async () => {
    mocks.membership.mockResolvedValueOnce({ data: { role: 'viewer', status: 'active' }, error: null })
    await expect(saveWorkspaceImageStyleAction(input)).resolves.toMatchObject({ error: { message: expect.stringContaining('소유자') } })
    await expect(saveWorkspaceImageStyleAction({ ...input, subject: '', avoid: '' })).resolves.toMatchObject({ error: { message: expect.stringContaining('한 가지') } })
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    await expect(saveWorkspaceImageStyleAction(input)).resolves.toMatchObject({ error: { message: expect.stringContaining('로그인') } })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('saves the guide, composition and reference photos, but only photos of this workspace', async () => {
    const ref = '30000000-0000-4000-8000-000000000001'
    mocks.ownedRefs.mockResolvedValue({ data: [{ id: ref }], error: null })
    await expect(saveWorkspaceImageStyleAction({ ...input, guide: '제품은 오른쪽', composition: '정면', references: [ref], referenceNotes: { [ref]: '여성 정면' } })).resolves.toEqual({ data: { version: 2 } })
    expect(mocks.rpcArgs).toHaveBeenCalledWith(expect.objectContaining({
      p_structured_rule: { custom: expect.objectContaining({ guide: '제품은 오른쪽', composition: '정면', referenceAssetIds: [ref], referenceNotes: { [ref]: '여성 정면' } }) },
    }))
    mocks.ownedRefs.mockResolvedValue({ data: [], error: null })
    await expect(saveWorkspaceImageStyleAction({ ...input, references: [ref] })).resolves.toMatchObject({ error: { message: expect.stringContaining('기준 사진') } })
  })

  it('filters reference photos by workspaceId and rights_status=confirmed', async () => {
    const ref = '30000000-0000-4000-8000-000000000001'
    mocks.ownedRefs.mockResolvedValue({ data: [{ id: ref }], error: null })
    await saveWorkspaceImageStyleAction({ ...input, references: [ref] })
    expect(mocks.mediaEq).toHaveBeenCalledWith('workspace_id', input.workspaceId)
    expect(mocks.mediaEq).toHaveBeenCalledWith('rights_status', 'confirmed')
  })

  it('reports a save failure', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'db' } })
    await expect(saveWorkspaceImageStyleAction(input)).resolves.toMatchObject({ error: { message: expect.stringContaining('저장하지 못했') } })
  })
})
