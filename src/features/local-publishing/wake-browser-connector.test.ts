import { describe,expect,it,vi } from 'vitest'
import { SOHEE_EXTENSION_ID,wakeBrowserConnector } from './wake-browser-connector'

const input={ workspaceId:'94000000-0000-4000-8000-000000000001',actionId:'94000000-0000-4000-8000-000000000002',
  connectionId:'94000000-0000-4000-8000-000000000003',requestId:'94000000-0000-4000-8000-000000000004',fingerprint:'a'.repeat(64) }
const scope={ scopeId:'94000000-0000-4000-8000-000000000005',actionId:input.actionId,
  deviceId:'94000000-0000-4000-8000-000000000006',targetExternalId:'scope-blog',expiresAt:'2026-10-16T12:00:00Z' }
const scopeFetch=() => vi.fn().mockResolvedValue(new Response(JSON.stringify({ data:scope }),{ status:200 }))

describe('exact approved Naver wake client', () => {
  it('records the server selection before reporting an absent extension', async () => {
    const fetch=scopeFetch()
    expect(await wakeBrowserConnector(input,{ fetch })).toEqual({ state:'extension_missing' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('sends only the server-authorized exact scope to the fixed extension', async () => {
    const fetch=scopeFetch(),sendMessage=vi.fn().mockResolvedValue({ ok:true,state:'approved_job_started' })
    expect(await wakeBrowserConnector(input,{ fetch,runtime:{ sendMessage } })).toEqual({ state:'approved_job_started' })
    expect(fetch).toHaveBeenCalledWith(`/api/workspaces/${input.workspaceId}/naver-connector/execution-scope`,expect.objectContaining({ method:'POST',credentials:'same-origin' }))
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ actionId:input.actionId,connectionId:input.connectionId,fingerprint:input.fingerprint,requestId:input.requestId })
    expect(sendMessage).toHaveBeenCalledWith(SOHEE_EXTENSION_ID,{
      type:'WAKE_APPROVED_NAVER_JOB',requestId:input.requestId,executionScope:{ scopeId:scope.scopeId,actionId:scope.actionId },
    })
    expect(fetch.mock.invocationCallOrder[0]).toBeLessThan(sendMessage.mock.invocationCallOrder[0])
  })

  it('does not wake anything after a rejected selection', async () => {
    const fetch=vi.fn().mockResolvedValue(new Response('{}',{ status:409 })),sendMessage=vi.fn()
    expect(await wakeBrowserConnector(input,{ fetch,runtime:{ sendMessage } })).toEqual({ state:'failed' })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('rejects a different action or secret-shaped authorization response', async () => {
    const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data:{ ...scope,actionId:input.connectionId } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data:{ ...scope,cookie:'never-accept' } })))
    const sendMessage=vi.fn()
    expect(await wakeBrowserConnector(input,{ fetch,runtime:{ sendMessage } })).toEqual({ state:'failed' })
    expect(await wakeBrowserConnector(input,{ fetch,runtime:{ sendMessage } })).toEqual({ state:'failed' })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('fails before any request for missing target or approval fields', async () => {
    const fetch=scopeFetch(),sendMessage=vi.fn()
    expect(await wakeBrowserConnector({ ...input,connectionId:'' },{ fetch,runtime:{ sendMessage } })).toEqual({ state:'failed' })
    expect(fetch).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('does not misdiagnose a server selection network error as a missing extension', async () => {
    const fetch=vi.fn().mockRejectedValue(new Error('offline'))
    expect(await wakeBrowserConnector(input,{ fetch })).toEqual({ state:'failed' })
  })

  it('preserves the distinction between an installed connector and unreachable browser', async () => {
    const fetch=scopeFetch(),sendMessage=vi.fn().mockResolvedValue({ ok:true,state:'cdp_unreachable' })
    expect(await wakeBrowserConnector(input,{ fetch,runtime:{ sendMessage } })).toEqual({ state:'cdp_unreachable' })
  })

  it('never accepts a published or credential-bearing runtime response', async () => {
    const fetch=scopeFetch(),sendMessage=vi.fn().mockResolvedValue({ ok:true,state:'published',token:'never-accept' })
    expect(await wakeBrowserConnector(input,{ fetch,runtime:{ sendMessage } })).toEqual({ state:'failed' })
  })
})
