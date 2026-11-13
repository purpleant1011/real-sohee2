// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), store: vi.fn() }))
vi.mock('../server/manager-auth', () => ({ authorizeManager: mocks.auth }))
vi.mock('../server/store-private-image', () => ({ storePrivateImage: mocks.store }))

import { saveComposedImageAction } from './compose-image'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]

function form(bytes: number[], type = 'image/png', ws: string = workspaceId) {
  const f = new FormData()
  f.set('workspaceId', ws)
  f.set('file', new File([new Uint8Array(bytes)], 'composed.png', { type }))
  return f
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ userId: 'u1', role: 'owner' })
  mocks.store.mockResolvedValue('50000000-0000-4000-8000-000000000001')
})

describe('saveComposedImageAction', () => {
  it('stores a composed PNG and returns its asset id and media url', async () => {
    await expect(saveComposedImageAction(form(PNG))).resolves.toEqual({
      data: { assetId: '50000000-0000-4000-8000-000000000001', url: `/api/workspaces/${workspaceId}/media/50000000-0000-4000-8000-000000000001` },
    })
    expect(mocks.store).toHaveBeenCalledWith(workspaceId, { userId: 'u1', role: 'owner' }, expect.any(File))
  })

  it('rejects non-PNG data, wrong mime types and a bad workspace before storing', async () => {
    await expect(saveComposedImageAction(form([1, 2, 3, 4, 5, 6, 7, 8, 9]))).resolves.toMatchObject({ error: { message: expect.stringContaining('PNG') } })
    await expect(saveComposedImageAction(form(PNG, 'image/jpeg'))).resolves.toMatchObject({ error: { message: expect.stringContaining('PNG') } })
    await expect(saveComposedImageAction(form(PNG, 'image/png', 'nope'))).resolves.toMatchObject({ error: { message: expect.stringContaining('작업공간') } })
    expect(mocks.store).not.toHaveBeenCalled()
  })

  it('blocks non-managers and reports storage failures', async () => {
    mocks.auth.mockResolvedValueOnce({ message: '소유자 또는 관리자만 이미지 스타일을 만들 수 있어요.' })
    await expect(saveComposedImageAction(form(PNG))).resolves.toMatchObject({ error: { message: expect.stringContaining('소유자') } })
    mocks.store.mockResolvedValueOnce(null)
    await expect(saveComposedImageAction(form(PNG))).resolves.toMatchObject({ error: { message: expect.stringContaining('저장하지 못했') } })
  })
})
