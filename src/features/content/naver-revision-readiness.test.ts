import { describe, expect, it, vi } from 'vitest'
import { loadNaverRevisionReadiness, naverRevisionUnavailable } from './naver-revision-readiness'

describe('Naver revision command readiness', () => {
  it.each([
    [{ ready: true, contract: 'naver-revision-v1' }, null, 'ready'],
    [{ ready: false, contract: 'naver-revision-v1' }, null, 'not_ready'],
    [null, { code: 'PGRST202' }, 'not_ready'],
    [null, { code: '42883' }, 'not_ready'],
    [{ ready: true, contract: 'other-contract' }, null, 'unavailable'],
    [{ ready: true, contract: 'naver-revision-v0' }, null, 'unavailable'],
    [true, null, 'unavailable'],
    [null, { code: '08006', message: 'private database detail' }, 'unavailable'],
  ] as const)('validates the read-only contract: %j', async (data, error, expected) => {
    const rpc = vi.fn(async () => ({ data, error }))
    expect(await loadNaverRevisionReadiness({ rpc } as never)).toBe(expected)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('naver_revision_readiness')
  })

  it('keeps transport loss unavailable rather than ready or a confirmed missing migration', async () => {
    expect(await loadNaverRevisionReadiness({ rpc: vi.fn().mockRejectedValue(new Error('private')) } as never)).toBe('unavailable')
  })

  it('recognizes only missing-function codes, not permission or serialization errors', () => {
    expect(naverRevisionUnavailable({ code: 'PGRST202' })).toBe(true)
    expect(naverRevisionUnavailable({ code: '42883' })).toBe(true)
    expect(naverRevisionUnavailable({ code: '42501' })).toBe(false)
    expect(naverRevisionUnavailable({ code: '40001' })).toBe(false)
  })
})
