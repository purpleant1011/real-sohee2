import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EngagementAutonomyDial } from './engagement-autonomy-dial'
import type { EngagementPolicy } from './types'

const mockPolicy: EngagementPolicy = {
  id: 'pol-1',
  workspace_id: 'ws-1',
  channel: 'instagram',
  auto_reply_enabled: true,
  is_paused: false,
  allowed_classes: ['THANKS', 'GREETING'],
  min_confidence: 0.85,
  daily_cap: 10,
  quiet_hours_enabled: false,
  quiet_hours_start: null,
  quiet_hours_end: null,
  max_comment_age_days: 7,
  autonomy_level: 'L2_ASSISTED',
  default_tone: 'witty',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
}

describe('EngagementAutonomyDial Component', () => {
  it('renders all 3 autonomy level cards (L1, L2, L3) with proper labels', () => {
    render(<EngagementAutonomyDial workspaceId="ws-1" initialPolicy={mockPolicy} />)

    expect(screen.getByText(/L1. 비서형/i)).toBeDefined()
    expect(screen.getByText(/L2. 협업형/i)).toBeDefined()
    expect(screen.getByText(/L3. 점장형/i)).toBeDefined()
    expect(screen.getByText(/안심 자율 가동 중/i)).toBeDefined()

    // Policy & Anti-exaggeration assertions
    expect(screen.queryByText(/승인 없이 소희가 알아서 소통할/)).not.toBeInTheDocument()
    expect(screen.queryByText(/알아서 센스있게 답하고/)).not.toBeInTheDocument()
    expect(screen.getByText(/소희가 고객 소통 및 응대 초안을 작성할 자율성 범위를 지정하세요/)).toBeInTheDocument()
    expect(screen.getByText(/센스있게 답글 초안을 준비하고/)).toBeInTheDocument()
  })

  it('renders tone selector chips when L2 or L3 is selected', () => {
    render(<EngagementAutonomyDial workspaceId="ws-1" initialPolicy={mockPolicy} />)

    expect(screen.getByText(/🎯 센스\/위트형/i)).toBeDefined()
    expect(screen.getByText(/💼 정중\/전문가형/i)).toBeDefined()
    expect(screen.getByText(/☕ 다정\/이웃형/i)).toBeDefined()
  })

  it('toggles pause state when pause button is clicked', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, policy: { ...mockPolicy, is_paused: true } }),
    }) as any

    render(<EngagementAutonomyDial workspaceId="ws-1" initialPolicy={mockPolicy} />)

    const pauseBtn = screen.getByRole('button', { name: /자율모드 일시정지/i })
    fireEvent.click(pauseBtn)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/workspaces/ws-1/engagement/policy',
        expect.objectContaining({
          method: 'PUT',
        })
      )
    })
  })
})
