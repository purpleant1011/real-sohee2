import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceContext } from '@/features/auth/workspace-context'
import { createDataDeletionRequestPostHandler } from './route'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const otherWorkspaceId = '10000000-0000-4000-8000-000000000002'
const userId = '20000000-0000-4000-8000-000000000001'
const confirmationCode = 'deletion_confirmation_code_123456'
const context = { params: Promise.resolve({ workspaceId }) }

function dependencies(role: WorkspaceContext['role'] = 'owner') {
  return {
    authenticate: vi.fn(async () => userId as string | null),
    authorize: vi.fn(async (): Promise<WorkspaceContext | null> => ({ workspaceId, role })),
    createRequest: vi.fn(async () => ({
      requestId: '30000000-0000-4000-8000-000000000001',
      confirmationCode,
    })),
  }
}

function request(scope: 'member' | 'workspace') {
  return new Request(`https://sohee.test/api/workspaces/${workspaceId}/data-deletion-requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope }),
  })
}

describe('POST data deletion request', () => {
  it('allows an active member to request deletion of their own workspace-linked data', async () => {
    const deps = dependencies('viewer')
    const response = await createDataDeletionRequestPostHandler(deps)(request('member'), context)

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      data: { statusUrl: `/data-deletion/status?code=${confirmationCode}` },
    })
    expect(deps.createRequest).toHaveBeenCalledWith({
      workspaceId,
      actorUserId: userId,
      scope: 'member',
    })
  })

  it('redirects the public form submission to the issued status page', async () => {
    const deps = dependencies('viewer')
    const formRequest = new Request(
      `https://sohee.test/api/workspaces/${workspaceId}/data-deletion-requests`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'scope=member',
      },
    )

    const response = await createDataDeletionRequestPostHandler(deps)(formRequest, context)

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      `https://sohee.test/data-deletion/status?code=${confirmationCode}`,
    )
  })

  it('requires the workspace owner for a full workspace deletion request', async () => {
    const deps = dependencies('manager')
    const response = await createDataDeletionRequestPostHandler(deps)(request('workspace'), context)

    expect(response.status).toBe(403)
    expect(deps.createRequest).not.toHaveBeenCalled()
  })

  it('stops before storage when the session or workspace boundary does not match', async () => {
    const anonymous = dependencies()
    anonymous.authenticate.mockResolvedValueOnce(null)
    const anonymousResponse = await createDataDeletionRequestPostHandler(anonymous)(request('member'), context)
    expect(anonymousResponse.status).toBe(401)
    expect(anonymous.createRequest).not.toHaveBeenCalled()

    const foreign = dependencies()
    foreign.authorize.mockResolvedValueOnce({ workspaceId: otherWorkspaceId, role: 'owner' })
    const foreignResponse = await createDataDeletionRequestPostHandler(foreign)(request('member'), context)
    expect(foreignResponse.status).toBe(403)
    expect(foreign.createRequest).not.toHaveBeenCalled()
  })
})
