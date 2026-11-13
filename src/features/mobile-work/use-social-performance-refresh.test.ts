import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SocialReportMetric } from '@/features/reports/types'
import { useSocialPerformanceRefresh } from './use-social-performance-refresh'

const mockCollectAction = vi.fn()

vi.mock('@/features/reports/actions/collect-social-performance', () => ({
  collectSocialPerformanceAction: (input: unknown) => mockCollectAction(input),
}))

describe('useSocialPerformanceRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const workspaceId = '10000000-0000-4000-8000-000000000001'
  const publishAttemptId = '20000000-0000-4000-8000-000000000001'
  const publishedAt = '2026-08-08T00:05:00.000Z'
  const initialMetrics: SocialReportMetric[] = [
    { metric: 'likes', state: 'available', value: 4 },
    { metric: 'views', state: 'no_data', value: null },
  ]

  it('초기 상태는 대기(idle)이며 초기 지표와 수집 시각을 보존한다', () => {
    const { result } = renderHook(() =>
      useSocialPerformanceRefresh({
        workspaceId,
        publishAttemptId,
        publishedAt,
        initialMetrics,
        initialCollectedAt: '2026-08-08T01:00:00.000Z',
      }),
    )

    expect(result.current.isPending).toBe(false)
    expect(result.current.cooldownRemaining).toBe(0)
    expect(result.current.metrics).toEqual(initialMetrics)
    expect(result.current.collectedAt).toBe('2026-08-08T01:00:00.000Z')
    expect(result.current.error).toBeNull()
    expect(result.current.isMissingScope).toBe(false)
  })

  it('새로고침 실행 중 pending 상태 및 30초 쿨다운이 활성화된다', async () => {
    let resolveAction!: (value: unknown) => void
    mockCollectAction.mockReturnValue(
      new Promise((res) => {
        resolveAction = res
      }),
    )

    const { result } = renderHook(() =>
      useSocialPerformanceRefresh({
        workspaceId,
        publishAttemptId,
        publishedAt,
      }),
    )

    act(() => {
      void result.current.refresh()
    })

    expect(result.current.isPending).toBe(true)
    expect(result.current.cooldownRemaining).toBe(30)

    // 액션 완료
    await act(async () => {
      resolveAction({
        data: {
          collectionId: 'col-1',
          status: 'succeeded',
          snapshot: {
            collectedAt: '2026-08-08T02:00:00.000Z',
            metrics: [{ metric: 'views', state: 'available', value: 10 }],
          },
        },
      })
    })

    expect(result.current.isPending).toBe(false)
    // 쿨다운은 여전히 남아있음
    expect(result.current.cooldownRemaining).toBe(30)

    // 쿨다운 중 중복 호출 시 액션이 재실행되지 않는다
    act(() => {
      void result.current.refresh()
    })
    expect(mockCollectAction).toHaveBeenCalledTimes(1)

    // 30초 경과 후 쿨다운 해제
    act(() => {
      vi.advanceTimersByTime(30000)
    })
    expect(result.current.cooldownRemaining).toBe(0)
  })

  it('수집 성공 시 스냅샷 지표와 수집 시각이 갱신된다', async () => {
    mockCollectAction.mockResolvedValue({
      data: {
        collectionId: 'col-1',
        status: 'succeeded',
        snapshot: {
          collectedAt: '2026-08-08T03:00:00.000Z',
          metrics: [
            { metric: 'views', state: 'available', value: 15 },
            { metric: 'likes', state: 'available', value: 8 },
          ],
        },
      },
    })

    const { result } = renderHook(() =>
      useSocialPerformanceRefresh({
        workspaceId,
        publishAttemptId,
        publishedAt,
        initialMetrics,
      }),
    )

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.metrics).toEqual([
      { metric: 'views', state: 'available', value: 15 },
      { metric: 'likes', state: 'available', value: 8 },
    ])
    expect(result.current.collectedAt).toBe('2026-08-08T03:00:00.000Z')
    expect(result.current.error).toBeNull()
  })

  it('권한 부족(missing scope / permission_denied) 시 안내 문구와 권한 부족 플래그가 설정된다', async () => {
    mockCollectAction.mockResolvedValue({
      data: {
        collectionId: 'col-1',
        status: 'permission_denied',
      },
    })

    const { result } = renderHook(() =>
      useSocialPerformanceRefresh({
        workspaceId,
        publishAttemptId,
        publishedAt,
      }),
    )

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.isMissingScope).toBe(true)
    expect(result.current.error).toBe('채널 연결 권한을 확인해 주세요')
  })

  it('일반 실패 시 기본 한국어 오류 문구가 설정된다', async () => {
    mockCollectAction.mockResolvedValue({
      error: {
        message: '채널 성과를 수집하지 못했습니다. 게시 결과와 연결 상태를 확인해 주세요.',
        requestId: 'social-performance-collect',
      },
    })

    const { result } = renderHook(() =>
      useSocialPerformanceRefresh({
        workspaceId,
        publishAttemptId,
        publishedAt,
      }),
    )

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.isMissingScope).toBe(false)
    expect(result.current.error).toBe('성과를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
  })

  it('UI 및 반환 객체에 크레딧 관련 텍스트가 포함되지 않는다', () => {
    const { result } = renderHook(() =>
      useSocialPerformanceRefresh({
        workspaceId,
        publishAttemptId,
        publishedAt,
        initialMetrics,
      }),
    )

    const serialized = JSON.stringify(result.current)
    expect(serialized).not.toContain('크레딧')
    expect(serialized).not.toContain('credit')
  })
})
