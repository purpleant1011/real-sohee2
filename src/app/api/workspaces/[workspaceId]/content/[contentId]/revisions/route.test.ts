import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const { authorize, reviseContent } = vi.hoisted(() => ({
  authorize: vi.fn(),
  reviseContent: vi.fn(),
}))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/features/content/canonical-content-lifecycle', () => ({
  CanonicalContentLifecycleService: { reviseContent },
}))

const workspaceId = '00000000-0000-0000-0000-0000000000ee'
const contentId = 'content-a-1'
const FOREIGN_MARKER = 'XTENANT_B_27770'

const ctx = () => ({ params: Promise.resolve({ workspaceId, contentId }) })
const request = () =>
  new NextRequest(`https://example.test/api/workspaces/${workspaceId}/content/${contentId}/revisions`, {
    method: 'POST',
    body: JSON.stringify({ expectedVersionId: 'v-1', caption: '수정 본문' }),
  })

beforeEach(() => {
  authorize.mockReset()
  reviseContent.mockReset()
  authorize.mockResolvedValue({ userId: 'user-owner', workspaceId, role: 'owner', supabase: {}, admin: {} })
  reviseContent.mockResolvedValue({ contentId, versionId: 'v-2', caption: '수정 본문' })
})

describe('content revisions route workspace authorization', () => {
  it('refuses a non-member before revising any workspace content', async () => {
    authorize.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: '해당 워크스페이스에 대한 접근 권한이 없습니다 (CROSS_TENANT_ACCESS_DENIED).' }),
        { status: 403 },
      ),
    )

    const response = await POST(request(), ctx())
    const body = await response.text()

    expect(response.status).toBe(403)
    expect(reviseContent).not.toHaveBeenCalled()
    expect(body).not.toContain(FOREIGN_MARKER)
  })

  it('본문만 수정하는 요청은 사진·해시태그를 빈 배열로 덮어쓰지 않는다', async () => {
    await POST(request(), ctx())
    expect(reviseContent).toHaveBeenCalledWith(expect.objectContaining({
      hashtags: undefined, mediaUrls: undefined, createdBy: 'user-owner',
    }))
  })

  it('revises content for an active member', async () => {
    const response = await POST(request(), ctx())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true })
    expect(reviseContent).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId, contentId, expectedVersionId: 'v-1' }),
    )
  })
})
