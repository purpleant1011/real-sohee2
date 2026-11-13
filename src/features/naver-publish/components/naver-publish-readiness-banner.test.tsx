import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { toast } from 'sonner'
import { NaverPublishReadinessBanner } from './naver-publish-readiness-banner'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const workspaceId = 'test-workspace-uuid'
function statusResponse(data: object) {
  return { ok: true, json: async () => data }
}

describe('NaverPublishReadinessBanner', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('does not offer content copy on a settings page without a copy callback', async () => {
    global.fetch = vi.fn().mockResolvedValue(statusResponse({ hasConnection: false, isOnline: false, canAutoPublish: false }))
    render(<NaverPublishReadinessBanner workspaceId={workspaceId} />)
    await screen.findByText('저장된 네이버 연결 기록이 없어요.')
    expect(screen.queryByRole('button', { name: /내용 복사 후 네이버 열기/ })).not.toBeInTheDocument()
    expect(screen.getByText(/확장프로그램 다운로드/)).toBeInTheDocument()
  })

  it('does not certify the current browser or promise 20 seconds from server heartbeat', async () => {
    global.fetch = vi.fn().mockResolvedValue(statusResponse({ hasConnection: true, isOnline: true, canAutoPublish: true, accountLabel: 'findk3' }))
    render(<NaverPublishReadinessBanner workspaceId={workspaceId} onPublishClick={vi.fn()} />)
    await screen.findByText(/findk3.*최근 기기 통신 기록 있음/)
    expect(screen.queryAllByText(/자동 게시 준비 완료|20초/)).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /자동 게시 시작/ })).not.toBeInTheDocument()
    expect(screen.getByText(/현재 브라우저.*별도 확인/)).toBeInTheDocument()
  })

  it('does not infer expired login from online but not publishable', async () => {
    global.fetch = vi.fn().mockResolvedValue(statusResponse({ hasConnection: true, isOnline: true, canAutoPublish: false }))
    render(<NaverPublishReadinessBanner workspaceId={workspaceId} />)
    await screen.findByText(/최근 기기 통신 기록 있음/)
    expect(screen.queryByText(/네이버 로그인이 필요해요|네이버 세션이 만료/)).not.toBeInTheDocument()
  })

  it('does not convert stale server reauth flags into a live login diagnosis', async () => {
    global.fetch = vi.fn().mockResolvedValue(statusResponse({ hasConnection: true, isOnline: false, canAutoPublish: false, reauthRequired: true }))
    render(<NaverPublishReadinessBanner workspaceId={workspaceId} />)
    await screen.findByText(/최근 기기 통신 미확인/)
    expect(screen.queryByText(/네이버 로그인이 필요해요/)).not.toBeInTheDocument()
  })

  it('offers a copy callback only when content is provided', async () => {
    global.fetch = vi.fn().mockResolvedValue(statusResponse({ hasConnection: false, isOnline: false }))
    const copy = vi.fn()
    render(<NaverPublishReadinessBanner workspaceId={workspaceId} onFastCopyClick={copy} />)
    fireEvent.click(await screen.findByRole('button', { name: /내용 복사 후 네이버 열기/ }))
    expect(copy).toHaveBeenCalledOnce()
  })

  it('clears previous heartbeat on a failed refresh instead of leaving a green record', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(statusResponse({ hasConnection: true, isOnline: true, accountLabel: 'findk3' }))
      .mockResolvedValueOnce({ ok: false })
    render(<NaverPublishReadinessBanner workspaceId={workspaceId} />)
    await screen.findByText(/최근 기기 통신 기록 있음/)
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    await screen.findByText('연결 기록을 조회하지 못했어요. 다시 확인해 주세요.')
    expect(screen.queryByText(/최근 기기 통신 기록 있음/)).not.toBeInTheDocument()
  })

  it('does not claim address copied if clipboard rejects permission', async () => {
    global.fetch = vi.fn().mockResolvedValue(statusResponse({ hasConnection: false, isOnline: false }))
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    try {
      render(<NaverPublishReadinessBanner workspaceId={workspaceId} />)
      fireEvent.click(screen.getByRole('button', { name: '관리자 주소 복사' }))
      await waitFor(() => expect(toast.error).toHaveBeenCalled())
      expect(toast.success).not.toHaveBeenCalled()
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })
})
