import { describe, expect, it, vi } from 'vitest'
import { createOperatorDataProvider } from './operator-data-provider'
import type { OperatorFetcher } from './operator-data-provider'

describe('createOperatorDataProvider', () => {
  it('maps workspace list reads to the protected Sohee operator endpoint', async () => {
    let requestUrl = ''
    let requestInit: RequestInit | undefined
    const fetcher: OperatorFetcher = async (input, init) => {
      requestUrl = String(input)
      requestInit = init
      return new Response(JSON.stringify({ data: [{ id: 'workspace-1' }], total: 1 }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    }
    const provider = createOperatorDataProvider(fetcher)

    await expect(provider.getList({
      resource: 'workspaces',
      pagination: { currentPage: 2, pageSize: 25, mode: 'server' },
      filters: [{ field: 'query', operator: 'contains', value: '바이름' }],
      sorters: [{ field: 'updatedAt', order: 'desc' }],
      meta: {},
    })).resolves.toEqual({ data: [{ id: 'workspace-1' }], total: 1 })

    expect(requestUrl).toContain('/api/admin/refine/workspaces?')
    expect(requestUrl).toContain('page=2')
    expect(requestUrl).toContain('pageSize=25')
    expect(requestUrl).toContain('query=%EB%B0%94%EC%9D%B4%EB%A6%84')
    expect(requestUrl).toContain('sort=updatedAt')
    expect(requestUrl).toContain('order=desc')
    expect(requestInit).toMatchObject({ credentials: 'same-origin', method: 'GET' })
  })

  it('fails closed for unknown resources before making a request', async () => {
    const fetcher = vi.fn()
    const provider = createOperatorDataProvider(fetcher)

    await expect(provider.getList({ resource: 'secrets', pagination: undefined, filters: [], sorters: [], meta: {} }))
      .rejects.toMatchObject({ message: '지원하지 않는 관리자 자료입니다.', statusCode: 404 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('maps server failures to a safe Refine error without exposing provider details', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'postgres-internal-secret' }), {
      headers: { 'content-type': 'application/json' },
      status: 503,
    }))
    const provider = createOperatorDataProvider(fetcher)

    await expect(provider.getList({ resource: 'workspaces', pagination: undefined, filters: [], sorters: [], meta: {} }))
      .rejects.toMatchObject({ message: '관리자 자료를 안전하게 불러오지 못했습니다.', statusCode: 503 })
  })
})
