import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatusLine } from '../components/status-line'

describe('StatusLine', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('정상 상태(IDLE, 승인 필요 0건)면 아무것도 렌더하지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          runtimeState: 'IDLE',
          ownerActionRequiredCount: 0,
        }),
      }),
    )

    const { container } = render(<StatusLine workspaceId="ws-1" />)

    await waitFor(() => {
      expect(fetch).toHaveBeenCalled()
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('BLOCKED 이면 안전 규칙 차단 안내를 렌더한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          runtimeState: 'BLOCKED',
          ownerActionRequiredCount: 0,
        }),
      }),
    )

    render(<StatusLine workspaceId="ws-1" />)

    await waitFor(() => {
      expect(screen.getByText('안전 규칙에 따라 업무가 멈췄어요. 멈춘 이유를 소희와 대화해서 확인해 주세요.')).toBeInTheDocument()
    })
  })

  it('PAUSED 이면 업무 멈춤 안내를 렌더한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          runtimeState: 'PAUSED',
          ownerActionRequiredCount: 0,
        }),
      }),
    )

    render(<StatusLine workspaceId="ws-1" />)

    await waitFor(() => {
      expect(screen.getByText('소희의 업무가 잠시 멈췄어요.')).toBeInTheDocument()
    })
  })

  it('승인 대기 건수가 있으면 해당 문구를 렌더한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          runtimeState: 'IDLE',
          ownerActionRequiredCount: 2,
        }),
      }),
    )

    render(<StatusLine workspaceId="ws-1" />)

    await waitFor(() => {
      expect(screen.getByText('사장님의 승인이 필요한 일이 2건 있어요.')).toBeInTheDocument()
    })
  })

  it('fetch 실패 시 조용히 비어 있는 상태를 유지한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

    const { container } = render(<StatusLine workspaceId="ws-1" />)

    await waitFor(() => {
      expect(fetch).toHaveBeenCalled()
    })
    expect(container).toBeEmptyDOMElement()
  })
})
