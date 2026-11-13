import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as listHarness, POST as createHarness } from './route'
import { GET as getHarnessDetail } from './[harnessId]/route'
import { POST as addOverride } from './[harnessId]/override/route'
import { POST as assignChannel } from './[harnessId]/assign/route'
import { POST as analyzeHarness } from './analyze/route'
import { POST as previewHarness } from './preview/route'

const { authorize, repo } = vi.hoisted(() => ({
  authorize: vi.fn(),
  repo: {
    getAssets: vi.fn(),
    getVersionById: vi.fn(),
    getRulesByVersionId: vi.fn(),
    addOverride: vi.fn(),
  },
}))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (value: unknown) => value instanceof Response,
}))

vi.mock('@/features/harness/supabase-harness-repository', () => ({
  supabaseHarnessRepository: repo,
}))

const workspaceId = 'b1000000-0000-4000-8000-000000000001'
const harnessId = 'harness_byreum_001'
const FOREIGN_MARKER = 'XTENANT_B_27770'

const memberAuth = { userId: 'user-owner', workspaceId, role: 'owner', supabase: {}, admin: {} }
const denial = () =>
  new Response(
    JSON.stringify({
      error: '해당 워크스페이스에 대한 접근 권한이 없습니다 (CROSS_TENANT_ACCESS_DENIED).',
    }),
    { status: 403 },
  )

/** Workspace-only context for the list/analyze/preview routes. */
const ctx = () => ({ params: Promise.resolve({ workspaceId }) })
/** Context for the [harnessId] routes. */
const ctxWithHarness = () => ({ params: Promise.resolve({ workspaceId, harnessId }) })

const getReq = (path: string) => new NextRequest(`http://localhost/api/workspaces/${workspaceId}/${path}`)
const postReq = (path: string, body: unknown) =>
  new NextRequest(`http://localhost/api/workspaces/${workspaceId}/${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

beforeEach(() => {
  authorize.mockReset()
  authorize.mockResolvedValue(memberAuth)
  repo.getAssets.mockReset().mockResolvedValue([
    { id: harnessId, workspaceId, title: `${FOREIGN_MARKER}_BIZ`, activeVersionId: 'v-1' },
  ])
  repo.getVersionById.mockReset().mockResolvedValue({ id: 'v-1', workspaceId })
  repo.getRulesByVersionId.mockReset().mockResolvedValue([{ id: 'r-1', ruleKey: 'tone' }])
  repo.addOverride.mockReset().mockResolvedValue({ id: 'o-1', ruleKey: 'custom_cta' })
})

/**
 * The harness repository writes and reads through the service-role client, so RLS does not
 * isolate workspaces. Each route must refuse a non-member before touching the repository.
 */
describe('harness routes cross-tenant authorization', () => {
  it('GET list refuses a non-member before reading harness assets', async () => {
    authorize.mockResolvedValueOnce(denial())

    const response = await listHarness(getReq('harness'), ctx())
    const body = await response.text()

    expect(response.status).toBe(403)
    expect(repo.getAssets).not.toHaveBeenCalled()
    expect(body).not.toContain(FOREIGN_MARKER)
  })

  it('POST create refuses a non-member before compiling a harness job', async () => {
    authorize.mockResolvedValueOnce(denial())

    const response = await createHarness(
      postReq('harness', { sourceUrl: 'https://blog.naver.com/xtenant-b-27770' }),
      ctx(),
    )
    const body = await response.text()

    expect(response.status).toBe(403)
    expect(repo.getAssets).not.toHaveBeenCalled()
    expect(body).not.toContain('xtenant-b-27770')
  })

  it('GET detail refuses a non-member before reading version and rules', async () => {
    authorize.mockResolvedValueOnce(denial())

    const response = await getHarnessDetail(getReq(`harness/${harnessId}`), ctxWithHarness())
    const body = await response.text()

    expect(response.status).toBe(403)
    expect(repo.getVersionById).not.toHaveBeenCalled()
    expect(repo.getRulesByVersionId).not.toHaveBeenCalled()
    expect(body).not.toContain(FOREIGN_MARKER)
  })

  it('POST override refuses a non-member before persisting a rule override', async () => {
    authorize.mockResolvedValueOnce(denial())

    const response = await addOverride(
      postReq(`harness/${harnessId}/override`, {
        module: 'text',
        ruleKey: 'custom_cta',
        overrideValue: `${FOREIGN_MARKER}_override`,
      }),
      ctxWithHarness(),
    )
    const body = await response.text()

    expect(response.status).toBe(403)
    expect(repo.addOverride).not.toHaveBeenCalled()
    expect(body).not.toContain(FOREIGN_MARKER)
  })

  it('POST assign refuses a non-member before binding a channel', async () => {
    authorize.mockResolvedValueOnce(denial())

    const response = await assignChannel(
      postReq(`harness/${harnessId}/assign`, { channelId: 'ch_b', channelPlatform: 'instagram' }),
      ctxWithHarness(),
    )
    const body = await response.text()

    expect(response.status).toBe(403)
    expect(body).not.toContain('ch_b')
  })

  it('POST analyze refuses a non-member before running the analyzer', async () => {
    authorize.mockResolvedValueOnce(denial())

    const response = await analyzeHarness(
      postReq('harness/analyze', { url: `https://blog.naver.com/${FOREIGN_MARKER}` }),
      ctx(),
    )
    const body = await response.text()

    expect(response.status).toBe(403)
    expect(repo.getAssets).not.toHaveBeenCalled()
    expect(body).not.toContain(FOREIGN_MARKER)
  })

  it('POST preview refuses a non-member before generating a preview', async () => {
    authorize.mockResolvedValueOnce(denial())

    const response = await previewHarness(postReq('harness/preview', { harnessId }), ctx())
    const body = await response.text()

    expect(response.status).toBe(403)
    expect(body).not.toContain(FOREIGN_MARKER)
  })
})

describe('harness routes keep member responses unchanged', () => {
  it('GET list returns the workspace assets to a member', async () => {
    const response = await listHarness(getReq('harness'), ctx())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(repo.getAssets).toHaveBeenCalledWith(workspaceId)
  })

  it('POST override persists for a member', async () => {
    const response = await addOverride(
      postReq(`harness/${harnessId}/override`, {
        module: 'text',
        ruleKey: 'custom_cta',
        overrideValue: '네이버 예약 시 10% 추가 할인',
      }),
      ctxWithHarness(),
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.override.ruleKey).toBe('custom_cta')
    expect(repo.addOverride).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId, harnessAssetId: harnessId }),
    )
  })

  it('POST assign binds the channel for a member', async () => {
    const response = await assignChannel(
      postReq(`harness/${harnessId}/assign`, {
        channelId: 'ch_insta_main',
        channelPlatform: 'instagram',
      }),
      ctxWithHarness(),
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.assignment.harnessAssetId).toBe(harnessId)
  })

  it('still validates input for a member', async () => {
    const response = await addOverride(
      postReq(`harness/${harnessId}/override`, { module: 'text' }),
      ctxWithHarness(),
    )

    expect(response.status).toBe(400)
    expect(repo.addOverride).not.toHaveBeenCalled()
  })
})
