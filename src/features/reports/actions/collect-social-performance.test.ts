import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { executeSocialPerformanceCollection } from './collect-social-performance-core'

const input = {
  workspaceId: '10000000-0000-4000-8000-000000000001',
  publishAttemptId: '20000000-0000-4000-8000-000000000001',
  requestKey: '30000000-0000-4000-8000-000000000001',
  periodStart: '2026-08-01T00:00:00.000Z',
  periodEnd: '2026-08-08T00:00:00.000Z',
}

function dependencies() {
  return {
    authorize: vi.fn().mockResolvedValue({
      workspaceId: input.workspaceId, role: 'manager' as const,
    }),
    loadContext: vi.fn().mockResolvedValue({
      workspaceId: input.workspaceId,
      publishAttemptId: input.publishAttemptId,
      channelConnectionId: '40000000-0000-4000-8000-000000000001',
      channel: 'instagram' as const,
      providerPostReference: 'ig-media-1',
      publishedAt: '2026-08-08T00:05:00.000Z',
    }),
    loadCredential: vi.fn().mockResolvedValue({
      accessToken: 'secret-provider-token', provider: 'instagram' as const,
      externalAccountId: 'ig-account-1', expiresAt: null,
    }),
    collect: vi.fn().mockResolvedValue({
      channel: 'instagram' as const,
      metrics: [
        { metric: 'views' as const, state: 'available' as const, value: 0 },
        { metric: 'likes' as const, state: 'available' as const, value: 4 },
        { metric: 'comments' as const, state: 'no_data' as const, value: null },
        { metric: 'saved' as const, state: 'no_data' as const, value: null },
        { metric: 'shares' as const, state: 'no_data' as const, value: null },
        { metric: 'visits' as const, state: 'not_supported' as const, value: null },
        { metric: 'inquiries' as const, state: 'not_supported' as const, value: null },
      ],
    }),
    save: vi.fn().mockResolvedValue({
      collectionId: '50000000-0000-4000-8000-000000000001',
    }),
    now: vi.fn(() => new Date('2026-08-08T01:00:00.000Z')),
  }
}

describe('collect social performance action core', () => {
  it('blocks a reviewer before loading a post, credential, or provider', async () => {
    const deps = dependencies()
    deps.authorize.mockResolvedValue({ workspaceId: input.workspaceId, role: 'reviewer' })

    await expect(executeSocialPerformanceCollection(input, deps)).resolves.toEqual({
      error: {
        message: '채널 성과 수집은 작업공간 소유자와 관리자만 실행할 수 있습니다.',
        requestId: 'social-performance-collect',
      },
    })
    expect(deps.loadContext).not.toHaveBeenCalled()
    expect(deps.collect).not.toHaveBeenCalled()
  })

  it('collects Metrics GET for the succeeded post and stores actual zero with the period', async () => {
    const deps = dependencies()

    await expect(executeSocialPerformanceCollection(input, deps)).resolves.toEqual({
      data: {
        collectionId: '50000000-0000-4000-8000-000000000001',
        status: 'succeeded',
      },
    })
    expect(deps.collect).toHaveBeenCalledWith({
      channel: 'instagram', providerPostId: 'ig-media-1', accessToken: 'secret-provider-token',
    })
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: input.workspaceId,
      publishAttemptId: input.publishAttemptId,
      requestKey: input.requestKey,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      collectedAt: '2026-08-08T01:00:00.000Z',
      status: 'succeeded',
      errorCode: null,
      metrics: expect.arrayContaining([
        { metric: 'views', state: 'available', value: 0 },
        { metric: 'visits', state: 'not_supported', value: null },
      ]),
    }))
  })

  it('stores permission denied states without inventing values', async () => {
    const deps = dependencies()
    deps.collect.mockRejectedValue(Object.assign(new Error('safe'), { code: 'PERMISSION_DENIED' }))

    await expect(executeSocialPerformanceCollection(input, deps)).resolves.toMatchObject({
      data: { status: 'permission_denied' },
    })
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({
      status: 'permission_denied',
      errorCode: null,
      metrics: [
        { metric: 'views', state: 'permission_denied', value: null },
        { metric: 'likes', state: 'permission_denied', value: null },
        { metric: 'comments', state: 'permission_denied', value: null },
        { metric: 'saved', state: 'permission_denied', value: null },
        { metric: 'shares', state: 'permission_denied', value: null },
        { metric: 'visits', state: 'not_supported', value: null },
        { metric: 'inquiries', state: 'not_supported', value: null },
      ],
    }))
  })

  it('stores a retry time for a transient provider failure', async () => {
    const deps = dependencies()
    deps.collect.mockRejectedValue(Object.assign(new Error('safe'), { code: 'RATE_LIMITED' }))

    await expect(executeSocialPerformanceCollection(input, deps)).resolves.toMatchObject({
      data: { status: 'failed' },
    })
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      errorCode: 'RATE_LIMITED',
      nextAttemptAt: '2026-08-08T01:15:00.000Z',
    }))
  })

  it('surfaces a distinct message and logs stage when loadContext throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps = dependencies()
    deps.loadContext.mockRejectedValue(Object.assign(new Error('게시 기록 없음'), { code: 'CONTEXT_NOT_FOUND' }))

    await expect(executeSocialPerformanceCollection(input, deps)).resolves.toEqual({
      error: {
        message: '게시 기록을 찾지 못했어요',
        requestId: 'social-performance-collect',
      },
    })
    expect(errorSpy).toHaveBeenCalledWith('[social-performance]', {
      stage: 'loadContext',
      code: 'CONTEXT_NOT_FOUND',
    })
    errorSpy.mockRestore()
  })

  it('surfaces a distinct message and logs stage when loadCredential throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps = dependencies()
    deps.loadCredential.mockRejectedValue(Object.assign(new Error('채널 연결 정보 없음'), { code: 'CREDENTIAL_FAILED' }))

    await expect(executeSocialPerformanceCollection(input, deps)).resolves.toEqual({
      error: {
        message: '채널 연결 정보를 확인해 주세요 (채널 설정에서 다시 연결)',
        requestId: 'social-performance-collect',
      },
    })
    expect(errorSpy).toHaveBeenCalledWith('[social-performance]', {
      stage: 'loadCredential',
      code: 'CREDENTIAL_FAILED',
    })
    errorSpy.mockRestore()
  })

  it('surfaces a distinct message and logs stage when save throws in happy path', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps = dependencies()
    deps.save.mockRejectedValue(Object.assign(new Error('저장 실패'), { code: 'SAVE_FAILED' }))

    await expect(executeSocialPerformanceCollection(input, deps)).resolves.toEqual({
      error: {
        message: '성과를 저장하지 못했어요',
        requestId: 'social-performance-collect',
      },
    })
    expect(errorSpy).toHaveBeenCalledWith('[social-performance]', {
      stage: 'save',
      code: 'SAVE_FAILED',
    })
    errorSpy.mockRestore()
  })

  it('surfaces a distinct message and logs stage when authorize throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps = dependencies()
    deps.authorize.mockRejectedValue(Object.assign(new Error('권한 조회 실패'), { code: 'AUTH_FAILED' }))

    await expect(executeSocialPerformanceCollection(input, deps)).resolves.toEqual({
      error: {
        message: '작업공간 권한을 확인하지 못했어요',
        requestId: 'social-performance-collect',
      },
    })
    expect(errorSpy).toHaveBeenCalledWith('[social-performance]', {
      stage: 'authorize',
      code: 'AUTH_FAILED',
    })
    errorSpy.mockRestore()
  })

  it('logs collect stage and surfaces save failure when collect errors and save fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps = dependencies()
    deps.collect.mockRejectedValue(Object.assign(new Error('safe'), { code: 'PERMISSION_DENIED' }))
    deps.save.mockRejectedValue(Object.assign(new Error('저장 실패'), { code: 'SAVE_FAILED' }))

    await expect(executeSocialPerformanceCollection(input, deps)).resolves.toEqual({
      error: {
        message: '성과를 저장하지 못했어요',
        requestId: 'social-performance-collect',
      },
    })
    expect(errorSpy).toHaveBeenCalledWith('[social-performance]', {
      stage: 'collect',
      code: 'PERMISSION_DENIED',
    })
    expect(errorSpy).toHaveBeenCalledWith('[social-performance]', {
      stage: 'save',
      code: 'SAVE_FAILED',
    })
    errorSpy.mockRestore()
  })

  it('never leaks tokens or credentials into console.error payload', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps = dependencies()
    deps.loadCredential.mockRejectedValue(Object.assign(
      new Error('leaked_token_EAAB12345'),
      { token: 'secret-token-12345', code: 'INVALID_CREDENTIAL' },
    ))

    await executeSocialPerformanceCollection(input, deps)

    expect(errorSpy).toHaveBeenCalledWith('[social-performance]', {
      stage: 'loadCredential',
      code: 'INVALID_CREDENTIAL',
    })
    const loggedArgs = errorSpy.mock.calls.flat()
    const serialized = JSON.stringify(loggedArgs)
    expect(serialized).not.toContain('secret-token-12345')
    expect(serialized).not.toContain('leaked_token_EAAB12345')
    errorSpy.mockRestore()
  })
})
