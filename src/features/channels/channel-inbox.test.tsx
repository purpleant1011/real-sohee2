import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChannelInteraction } from './interaction-repository'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('./actions/approve-and-send-response', () => ({ approveAndSendResponseAction: vi.fn() }))

import { ChannelInbox } from './channel-inbox'
import { approveAndSendResponseAction } from './actions/approve-and-send-response'

const interaction: ChannelInteraction = {
  id: '20000000-0000-4000-8000-000000000001', channel: 'instagram', category: 'comment',
  occurredAt: '2026-08-13T08:00:00.000Z', inboundText: '예약 가능한가요?',
  responseJobId: '30000000-0000-4000-8000-000000000001', responseText: '네, 가능합니다.',
  responseStatus: 'draft', responseApprovedAt: null, deliveryStatus: null, deliveryErrorCode: null,
  content: null, schedule: null,
}

describe('ChannelInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(approveAndSendResponseAction).mockResolvedValue({ data: { status: 'sent', errorCode: null } })
  })

  it('offers one approval-and-send action without exposing external identifiers', async () => {
    const { container } = render(<ChannelInbox
      workspaceId="10000000-0000-4000-8000-000000000001"
      role="manager"
      interactions={[interaction]}
    />)

    const textarea = screen.getByRole('textbox', { name: '소희 응답 문안' })
    expect(screen.getByRole('heading', { name: '소희 문의답변' })).toBeInTheDocument()
    expect(screen.getByText('예약 문의')).toBeInTheDocument()
    expect(textarea).toHaveValue('네, 가능합니다.')
    expect(screen.getAllByRole('button')).toHaveLength(1)
    fireEvent.change(textarea, { target: { value: '가능합니다. 원하시는 시간을 알려주세요.' } })
    fireEvent.click(screen.getByRole('button', { name: '승인하고 전송' }))

    await waitFor(() => expect(approveAndSendResponseAction).toHaveBeenCalledWith({
      workspaceId: '10000000-0000-4000-8000-000000000001',
      responseJobId: interaction.responseJobId,
      draftText: '가능합니다. 원하시는 시간을 알려주세요.',
    }))
    expect(container.textContent).not.toContain('external_subject_id')
    expect(container.textContent).not.toContain('provider_request_id')
  })

  it('does not expose a send button for sent or unknown responses', () => {
    const { rerender } = render(<ChannelInbox
      workspaceId="10000000-0000-4000-8000-000000000001" role="owner"
      interactions={[{ ...interaction, responseStatus: 'sent', deliveryStatus: 'succeeded' }]}
    />)
    expect(screen.queryByRole('button', { name: '승인하고 전송' })).not.toBeInTheDocument()

    rerender(<ChannelInbox
      workspaceId="10000000-0000-4000-8000-000000000001" role="owner"
      interactions={[{ ...interaction, responseStatus: 'unknown', deliveryStatus: 'unknown' }]}
    />)
    expect(screen.queryByRole('button', { name: '승인하고 전송' })).not.toBeInTheDocument()
  })
})
