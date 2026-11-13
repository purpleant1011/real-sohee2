import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildChatContext } from '@/features/chat/chat-context'
import { mockChatProvider } from './mock-chat-provider'

const resourceId = '11111111-1111-4111-8111-111111111111'
const notice = '모의 답변 · 실행 전 최종 확인 필요'

function input(
  kind: 'content' | 'schedule' | 'notification' | 'knowledge' | 'automation' = 'content',
) {
  return {
    message: '다음에 무엇을 확인하면 될까요?',
    context: buildChatContext('/app/work', {
      kind,
      id: resourceId,
      title: '선택한 작업',
      statusLabel: '승인 대기',
      summary: '안전한 검토 요약',
    }),
    simulation: 'success',
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('mockChatProvider', () => {
  it('declares mock mode and returns a visibly review-only success result', async () => {
    const result = await mockChatProvider.reply(input())

    expect(mockChatProvider.mode).toBe('mock')
    expect(result).toEqual({
      status: 'success',
      mode: 'mock',
      notice,
      message: '선택한 콘텐츠의 현재 상태를 검토했습니다. 관련 화면에서 최종 확인해 주세요.',
      errorCode: null,
      actions: [
        {
          label: '콘텐츠 검토 화면 열기',
          href: `/app/work/${resourceId}`,
          requiresConfirmation: true,
        },
      ],
    })
  })

  it.each([
    ['content', '콘텐츠 검토 화면 열기', `/app/work/${resourceId}`],
    ['schedule', '일정 확인 화면 열기', `/app/schedule?item=${resourceId}`],
    ['notification', '알림 확인 화면 열기', `/app/notifications?item=${resourceId}`],
    ['knowledge', '지식 확인 화면 열기', `/app/account/knowledge?item=${resourceId}`],
    ['automation', '자동화 확인 화면 열기', `/app/account/automation?item=${resourceId}`],
  ] as const)(
    'maps %s to a confirmation-only review link',
    async (kind, label, href) => {
      const result = await mockChatProvider.reply(input(kind))

      expect(result.status).toBe('success')
      expect(result.actions).toEqual([{ label, href, requiresConfirmation: true }])
      expect(result.actions.every((action) => action.requiresConfirmation)).toBe(true)
    },
  )

  it('returns only a current-screen confirmation action when no resource is selected', async () => {
    const result = await mockChatProvider.reply({
      message: '현재 화면을 설명해 주세요.',
      context: buildChatContext('/app/reports', null),
      simulation: 'success',
    })

    expect(result).toMatchObject({
      status: 'success',
      message: '현재 화면을 기준으로 확인할 항목을 정리했습니다. 실행 전 최종 확인해 주세요.',
      actions: [
        {
          label: '현재 화면 확인하기',
          href: '/app/reports',
          requiresConfirmation: true,
        },
      ],
    })
  })

  it.each([
    [
      'temporary_failure',
      {
        status: 'failed',
        message: '모의 답변을 준비하지 못했습니다. 다시 시도해 주세요.',
        errorCode: 'MOCK_TEMPORARY_FAILURE',
      },
    ],
    [
      'cancelled',
      {
        status: 'cancelled',
        message: '요청을 취소했습니다. 실행된 작업은 없습니다.',
        errorCode: null,
      },
    ],
  ] as const)('maps %s to an exact safe state with no actions', async (simulation, expected) => {
    const result = await mockChatProvider.reply({ ...input(), simulation })

    expect(result).toEqual({
      ...expected,
      mode: 'mock',
      notice,
      actions: [],
    })
  })

  it.each([
    ['missing message', { message: undefined }],
    ['empty message', { message: '  ' }],
    ['oversized message', { message: '가'.repeat(501) }],
    ['unsafe message', { message: 'token=secret-value' }],
    ['unsupported simulation', { simulation: 'live' }],
    ['missing context', { context: undefined }],
    ['extra input key', { rawPrompt: 'server prompt' }],
  ])('returns INVALID_INPUT without throwing for %s', async (_label, override) => {
    const result = await mockChatProvider.reply({ ...input(), ...override })

    expect(result).toEqual({
      status: 'failed',
      mode: 'mock',
      notice,
      message: '요청 내용을 안전하게 확인할 수 없습니다. 다시 입력해 주세요.',
      errorCode: 'INVALID_INPUT',
      actions: [],
    })
  })

  it('never echoes the caller message or selected-resource values', async () => {
    const sensitiveMessage = '다음 작업을 알려 주세요 unique-user-message-8302'
    const selectedTitle = '선택 자료 고유 제목 4401'
    const selectedSummary = '선택 자료 고유 요약 7751'
    const result = await mockChatProvider.reply({
      message: sensitiveMessage,
      context: buildChatContext('/app/work', {
        kind: 'content',
        id: resourceId,
        title: selectedTitle,
        statusLabel: '승인 대기',
        summary: selectedSummary,
      }),
      simulation: 'success',
    })
    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain(sensitiveMessage)
    expect(serialized).not.toContain(selectedTitle)
    expect(serialized).not.toContain(selectedSummary)
  })

  it('does not echo a sensitive or encoded caller route in a success action', async () => {
    for (const route of ['/app/token=secret-value', '/app/%3ftoken%3dsecret-value']) {
      const result = await mockChatProvider.reply({
        message: '현재 화면을 설명해 주세요.',
        context: { route, selectedResource: null },
        simulation: 'success',
      })
      const serialized = JSON.stringify(result)

      expect(result.actions).toEqual([
        {
          label: '현재 화면 확인하기',
          href: '/app',
          requiresConfirmation: true,
        },
      ])
      expect(serialized).not.toContain('secret-value')
    }
  })

  it('does not return direct approve, schedule, or publish operations', async () => {
    const result = await mockChatProvider.reply(input())
    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain('approve_content_version')
    expect(serialized).not.toContain('schedule_approved_content')
    expect(serialized).not.toContain('record_publish_attempt')
    expect(serialized).not.toContain('/api/')
    expect(result.actions.every((action) => action.requiresConfirmation === true)).toBe(true)
  })

  it('reads each approved top-level input field once and keeps the first observation', async () => {
    const reads = { message: 0, context: 0, simulation: 0 }
    const context = buildChatContext('/app/work', null)
    const dynamicInput = {
      get message() {
        reads.message += 1
        return reads.message === 1 ? '안전한 질문' : 'token=secret-value'
      },
      get context() {
        reads.context += 1
        return reads.context === 1 ? context : undefined
      },
      get simulation() {
        reads.simulation += 1
        return reads.simulation === 1 ? 'success' : 'temporary_failure'
      },
    }

    await expect(mockChatProvider.reply(dynamicInput)).resolves.toMatchObject({ status: 'success' })
    expect(reads).toEqual({ message: 1, context: 1, simulation: 1 })
  })

  it('fails closed without throwing for throwing and revoked input proxies', async () => {
    const throwing = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('must fail closed')
        },
      },
    )
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()

    await expect(mockChatProvider.reply(throwing)).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'INVALID_INPUT',
    })
    await expect(mockChatProvider.reply(revoked.proxy)).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'INVALID_INPUT',
    })
  })

  it('returns fresh deeply frozen results and actions', async () => {
    const first = await mockChatProvider.reply(input())
    const second = await mockChatProvider.reply(input())

    expect(first).not.toBe(second)
    expect(first.actions).not.toBe(second.actions)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.actions)).toBe(true)
    expect(Object.isFrozen(first.actions[0])).toBe(true)
    expect(() => {
      ;(first as { message: string }).message = '오염'
    }).toThrow()
    expect(() => {
      ;(first.actions as unknown as Array<unknown>).push('오염')
    }).toThrow()
    expect(second.status).toBe('success')
  })

  it('does not mutate a frozen caller input', async () => {
    const frozenInput = Object.freeze(input())
    const before = { ...frozenInput }

    await mockChatProvider.reply(frozenInput)

    expect(frozenInput).toEqual(before)
  })

  it('does not use network, time, randomness, or global crypto', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('fetch must not be called')
    })
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now must not be called')
    })
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be called')
    })
    const cryptoGetSpy = vi.fn(() => {
      throw new Error('crypto must not be read')
    })
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('crypto', new Proxy({}, { get: cryptoGetSpy }))

    await expect(mockChatProvider.reply(input())).resolves.toMatchObject({ status: 'success' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(dateNowSpy).not.toHaveBeenCalled()
    expect(randomSpy).not.toHaveBeenCalled()
    expect(cryptoGetSpy).not.toHaveBeenCalled()
  })
})
