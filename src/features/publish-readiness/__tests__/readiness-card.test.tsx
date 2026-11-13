import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadinessCard } from '../readiness-card'
import type { PublishReadinessResult } from '../types'

describe('ReadinessCard Component', () => {
  const readyData: PublishReadinessResult = {
    state: 'ready',
    channels: [
      {
        channel: 'instagram',
        channel_label: '인스타그램',
        state: 'ready',
        items: [
          { key: 'channel_connection', label: '채널 연결', state: 'ok', reason: null, action: null },
          { key: 'login_persistence', label: '로그인 유지', state: 'ok', reason: null, action: null },
          { key: 'publish_permission', label: '게시 권한', state: 'ok', reason: null, action: null },
          { key: 'account_verification', label: '계정 확인', state: 'ok', reason: null, action: null },
        ],
      },
    ],
    global_items: [
      { key: 'system_publish_feature', label: '소희의 실제 게시 기능', state: 'ok', reason: null, action: null },
      { key: 'agent_pause_status', label: '일시 정지', state: 'ok', reason: null, action: null },
      { key: 'approved_vault_items', label: '승인된 보관 글', state: 'ok', reason: null, action: null },
    ],
  }

  const blockedData: PublishReadinessResult = {
    state: 'blocked',
    channels: [
      {
        channel: 'instagram',
        channel_label: '인스타그램',
        state: 'blocked',
        items: [
          {
            key: 'channel_connection',
            label: '채널 연결',
            state: 'blocked',
            reason: '채널이 아직 연결되지 않았어요. 채널을 연결해 주세요',
            action: { label: '채널 연결하기', href: '/app/system' },
          },
          {
            key: 'login_persistence',
            label: '로그인 유지',
            state: 'unknown',
            reason: '지금은 확인하지 못했어요. 잠시 후 다시 확인해 주세요',
            action: null,
          },
        ],
      },
    ],
    global_items: [
      {
        key: 'system_publish_feature',
        label: '소희의 실제 게시 기능',
        state: 'blocked',
        reason: '소희의 실제 게시 기능이 아직 켜지지 않았어요. 켜지면 알려드릴게요.',
        action: null,
      },
      {
        key: 'agent_pause_status',
        label: '일시 정지',
        state: 'blocked',
        reason: '긴급 정지가 켜져 있어서 지금은 게시할 수 없어요.',
        action: { label: '다시 시작하기', href: '/app' },
      },
    ],
  }

  it('renders top summary line with role=status and aria-live', () => {
    render(<ReadinessCard workspaceId="ws-123" initialData={readyData} />)

    const summary = screen.getByRole('status')
    expect(summary).toHaveAttribute('aria-live', 'polite')
    expect(summary.textContent).toContain('첫 게시할 준비가 됐어요')
  })

  it('contains Korean-only labels and no English uppercase codes', () => {
    const { container } = render(
      <ReadinessCard workspaceId="ws-123" initialData={blockedData} defaultCollapsed={false} />
    )

    const textContent = container.textContent || ''
    // Invariant: Korean-only user text, no English status codes/UUID/SHA
    expect(textContent).not.toMatch(/[A-Z_]{4,}/)
    expect(textContent).not.toContain('ERROR')
    expect(textContent).not.toContain('EMPTY')
    expect(textContent).not.toContain('UNKNOWN')
    expect(textContent).not.toContain('예약됨')
  })

  it('renders reasons and action links for blocked items', () => {
    render(
      <ReadinessCard workspaceId="ws-123" initialData={blockedData} defaultCollapsed={false} />
    )

    expect(screen.getByText('소희의 실제 게시 기능이 아직 켜지지 않았어요. 켜지면 알려드릴게요.')).toBeInTheDocument()
    expect(screen.getByText('긴급 정지가 켜져 있어서 지금은 게시할 수 없어요.')).toBeInTheDocument()
    const resumeLink = screen.getByRole('link', { name: '다시 시작하기' })
    expect(resumeLink).toHaveAttribute('href', '/app')
  })

  it('triggers refetch when clicking 다시 확인하기 button', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: readyData }),
    })
    global.fetch = fetchMock

    render(<ReadinessCard workspaceId="ws-123" initialData={blockedData} />)

    const refreshButton = screen.getByRole('button', { name: /다시 확인하기/i })
    fireEvent.click(refreshButton)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/ws-123/publish-readiness',
      expect.objectContaining({ cache: 'no-store' })
    )
  })

  it('allows expanding and collapsing via keyboard or click', () => {
    render(<ReadinessCard workspaceId="ws-123" initialData={readyData} defaultCollapsed={true} />)

    const toggleButton = screen.getByRole('button', { name: /전체 항목 자세히 보기/i })
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggleButton)
    expect(screen.getByRole('button', { name: /전체 항목 접기/i })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('기본 점검 항목')).toBeInTheDocument()
  })
})
