import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppError from './error'

describe('AppError', () => {
  afterEach(() => {
    vi.useRealTimers()
    window.sessionStorage.clear()
  })

  it('게시 완료 뒤 일시적인 화면 조립 실패를 안전한 문구로 안내하고 한 번 자동 복구한다', async () => {
    vi.useFakeTimers()
    const reset = vi.fn()
    const error = Object.assign(new Error('transient route read failed'), { digest: 'route-read-1' })

    render(<AppError error={error} reset={reset} />)

    expect(screen.queryByText('데이터를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.')).not.toBeInTheDocument()
    expect(screen.getByText('게시 결과와 대화는 안전하게 보존되어 있어요. 화면을 다시 연결하고 있어요.')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(reset).toHaveBeenCalledTimes(1)
  })
})
