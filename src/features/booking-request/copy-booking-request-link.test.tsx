import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CopyBookingRequestLinkButton } from './copy-booking-request-link'
import { toast } from 'sonner'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

describe('CopyBookingRequestLinkButton', () => {
  const workspaceId = 'ws-test-123'
  const targetUrl = 'https://example.com/booking-request?token=sample.token'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches link and copies to clipboard successfully', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, url: targetUrl }),
    } as any)

    render(<CopyBookingRequestLinkButton workspaceId={workspaceId} />)

    const button = screen.getByRole('button', { name: /예약 신청 링크 복사|신청 링크 복사/ })
    fireEvent.click(button)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(`/api/workspaces/${workspaceId}/booking-request/link`)
      expect(writeTextMock).toHaveBeenCalledWith(targetUrl)
      expect(toast.success).toHaveBeenCalledWith('예약 신청 링크를 복사했어요')
    })
  })

  it('shows fallback input dialog when clipboard copy fails', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('Clipboard permission denied')),
      },
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, url: targetUrl }),
    } as any)

    render(<CopyBookingRequestLinkButton workspaceId={workspaceId} />)

    const button = screen.getByRole('button', { name: /예약 신청 링크 복사|신청 링크 복사/ })
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      const input = screen.getByRole('textbox') as HTMLInputElement
      expect(input.value).toBe(targetUrl)
    })
  })

  it('shows error toast when API fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: '예약 신청 링크를 만들 수 없어요(설정 필요)' }),
    } as any)

    render(<CopyBookingRequestLinkButton workspaceId={workspaceId} />)

    const button = screen.getByRole('button', { name: /예약 신청 링크 복사|신청 링크 복사/ })
    fireEvent.click(button)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('예약 신청 링크를 만들 수 없어요(설정 필요)')
    })
  })
})
