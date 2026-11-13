import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireOperator: vi.fn(), gateway: vi.fn(), record: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/features/operator-auth/require-operator', () => ({ requireOperator: mocks.requireOperator }))
vi.mock('./repository', () => ({ createPreflightQueueGateway: mocks.gateway }))
vi.mock('./service', () => ({ recordOperatorAction: mocks.record }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
import { preflightQueueAction } from './actions'

const form = () => {
  const data = new FormData()
  data.set('kind', 'add_memo')
  data.set('workspaceId', 'e1559000-0000-4000-8000-000000000001')
  data.set('vaultItemId', 'e1559000-0000-4000-8000-000000000002')
  data.set('note', '재확인 필요')
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireOperator.mockResolvedValue({ userId: 'operator-1' })
  mocks.record.mockResolvedValue({ ok: true })
})

describe('preflight queue operator action', () => {
  it('returns a user-visible error when the event was not recorded, without revalidating', async () => {
    mocks.record.mockResolvedValueOnce({ ok: false, message: '기록하지 못했어요.' })
    const result = await preflightQueueAction({ ok: true }, form())
    expect(result).toEqual({ ok: false, message: '기록하지 못했어요.' })
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('revalidates only after a successful append', async () => {
    const result = await preflightQueueAction({ ok: true }, form())
    expect(result).toEqual({ ok: true })
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/preflight')
  })
})
