import React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGrowthSnapshot } from '../use-growth-snapshot'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('useGrowthSnapshot', () => {
  it('성공하면 스냅샷을 돌려준다', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { completenessPercent: 42 } }) })
    const { result } = renderHook(() => useGrowthSnapshot('ws-1'))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.snapshot?.completenessPercent).toBe(42)
    expect(result.current.error).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/ws-1/sohee-growth', expect.objectContaining({ cache: 'no-store' }))
  })

  it('실패하면 사용자용 오류 문구를 준다', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ success: false }) })
    const { result } = renderHook(() => useGrowthSnapshot('ws-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.snapshot).toBeNull()
    expect(result.current.error).toBe('소희의 성장 현황을 불러오지 못했어요.')
  })

  it('작업공간이 없으면 요청하지 않는다', async () => {
    renderHook(() => useGrowthSnapshot(''))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
