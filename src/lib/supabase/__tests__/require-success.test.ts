import { describe, it, expect, vi } from 'vitest'
import {
  assertSupabaseSuccess,
  requireSuccess,
  failClosedMutationGuard,
  SupabasePersistenceError,
} from '../require-success'

describe('Supabase Mutation Fail-Closed Guard (ANI-990)', () => {
  it('throws SupabasePersistenceError when response contains an error object (resolved false-success)', () => {
    const falseSuccessResponse = {
      data: null,
      error: {
        message: 'violates foreign key constraint "fk_workspace"',
        code: '23503',
        details: 'Key is not present in table "workspaces".',
        hint: null,
      },
    }

    expect(() =>
      assertSupabaseSuccess(falseSuccessResponse, 'Workspace profile persistence')
    ).toThrow(SupabasePersistenceError)

    try {
      assertSupabaseSuccess(falseSuccessResponse, 'Workspace profile persistence')
    } catch (err) {
      expect(err).toBeInstanceOf(SupabasePersistenceError)
      const pErr = err as SupabasePersistenceError
      expect(pErr.code).toBe('23503')
      expect(pErr.message).toContain('Workspace profile persistence')
      expect(pErr.message).toContain('violates foreign key constraint')
      expect(pErr.details).toBe('Key is not present in table "workspaces".')
    }
  })

  it('returns data directly when response has no error', () => {
    const successResponse = {
      data: { id: 'rec_123', status: 'saved' },
      error: null,
    }

    const data = assertSupabaseSuccess(successResponse, 'Save record')
    expect(data).toEqual({ id: 'rec_123', status: 'saved' })
  })

  it('requireSuccess awaits a thenable and unwraps data or throws SupabasePersistenceError', async () => {
    const successfulPromise = Promise.resolve({
      data: [{ id: 'job_1' }],
      error: null,
    })

    const result = await requireSuccess(successfulPromise, 'Fetch jobs')
    expect(result).toEqual([{ id: 'job_1' }])

    const failingPromise = Promise.resolve({
      data: null,
      error: {
        message: 'relation "agent_runs" does not exist',
        code: '42P01',
      },
    })

    await expect(requireSuccess(failingPromise, 'Insert agent run')).rejects.toThrow(
      SupabasePersistenceError
    )
  })

  it('failClosedMutationGuard strictly blocks downstream action when persistence fails', async () => {
    const mockDownstreamProvider = vi.fn().mockResolvedValue({ published: true })

    const failingDbMutation = vi.fn().mockResolvedValue({
      data: null,
      error: {
        message: 'duplicate key value violates unique constraint',
        code: '23505',
      },
    })

    await expect(
      failClosedMutationGuard(
        failingDbMutation,
        mockDownstreamProvider,
        'External action request persistence'
      )
    ).rejects.toThrow(SupabasePersistenceError)

    // Critical Invariant: Provider MUST NOT be called if persistence failed!
    expect(mockDownstreamProvider).not.toHaveBeenCalled()
  })

  it('failClosedMutationGuard executes downstream action only after successful persistence', async () => {
    const mockDownstreamProvider = vi.fn().mockResolvedValue({ externalId: 'post_999' })

    const successfulDbMutation = vi.fn().mockResolvedValue({
      data: { requestId: 'req_abc', status: 'PENDING' },
      error: null,
    })

    const result = await failClosedMutationGuard(
      successfulDbMutation,
      mockDownstreamProvider,
      'External action request persistence'
    )

    expect(result.data).toEqual({ requestId: 'req_abc', status: 'PENDING' })
    expect(result.result).toEqual({ externalId: 'post_999' })
    expect(mockDownstreamProvider).toHaveBeenCalledTimes(1)
    expect(mockDownstreamProvider).toHaveBeenCalledWith({ requestId: 'req_abc', status: 'PENDING' })
  })
})
