import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ContentStudioRenewal } from '@/components/content/content-studio-renewal'

vi.mock('@/features/pwa/use-external-write-guard', () => ({
  useExternalWriteGuard: () => vi.fn((fn: () => Promise<unknown>) => fn()),
}))

describe('ContentStudioRenewal Canonical Mission Consumption (Item 1 Review Fix)', () => {
  const workspaceId = 'ws-test-canonical-123'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('correctly maps canonicalMissions DTO (canonicalStatus: PLANNING) to inProgress queue without requiring raw metadata', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes('/api/workspaces/')) {
        return {
          ok: true,
          json: async () => ({ success: true, contents: [] }),
        } as Response
      }
      if (urlStr.includes('/api/missions')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            canonicalMissions: [
              {
                missionId: 'msn-canonical-001',
                workspaceId,
                canonicalStatus: 'PLANNING',
                executionState: 'DRAFT',
                goal: '봄맞이 속눈썹 펌 이벤트 기획',
                targetChannel: 'instagram',
                userBadge: '마케팅 전략 수립 중',
                userCopy: '소희가 맞춤형 마케팅 콘텐츠를 제작하고 있습니다.',
              },
            ],
          }),
        } as Response
      }
      return { ok: false, status: 404 } as Response
    })

    render(<ContentStudioRenewal workspaceId={workspaceId} />)

    await waitFor(() => {
      expect(screen.getByText('봄맞이 속눈썹 펌 이벤트 기획')).toBeInTheDocument()
    })

    expect(screen.getByText('초안 구상 중 (V1)')).toBeInTheDocument()
    expect(screen.getByText('완료 후 승인 대기')).toBeInTheDocument()
  })

  it('correctly maps canonical items array (status: QUEUED / executionState: READY) to inProgress queue', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes('/api/workspaces/')) {
        return {
          ok: true,
          json: async () => ({ success: true, contents: [] }),
        } as Response
      }
      if (urlStr.includes('/api/missions')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            items: [
              {
                missionId: 'msn-canonical-002',
                workspaceId,
                canonicalStatus: 'QUEUED',
                executionState: 'READY',
                goal: '첫 방문 고객 20% 할인 프로모션',
                targetChannel: 'threads',
                userBadge: '새 마케팅 지시 수신',
                userCopy: '마케팅 업무를 안전하게 진행하고 있습니다.',
              },
            ],
          }),
        } as Response
      }
      return { ok: false, status: 404 } as Response
    })

    render(<ContentStudioRenewal workspaceId={workspaceId} />)

    await waitFor(() => {
      expect(screen.getByText('첫 방문 고객 20% 할인 프로모션')).toBeInTheDocument()
    })

    expect(screen.getByText('초안 구상 중 (V1)')).toBeInTheDocument()
  })
})
