// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ResultScreenView } from './result-screen-view'
import { deriveFirstPostOutcome } from './publish-outcome'

const view = (outcome: Parameters<typeof deriveFirstPostOutcome>[0], handle: string | null = '@shop', seen: string | null = '@shop') =>
  render(
    <ResultScreenView
      input={{ outcome: deriveFirstPostOutcome(outcome), evidence: { instagram: { approvedHandle: handle, readbackAccount: seen } } }}
    />,
  )

describe('ResultScreenView', () => {
  it('독립 readback 이 있으면 게시 확인과 링크를 보여준다', () => {
    view({ overallStatus: 'ALL_VERIFIED', receipts: { instagram: { channel: 'instagram', stage: 'OUTCOME_OBSERVED', permalink: 'https://www.instagram.com/p/x/', verifiedAt: '2026-10-23T09:00:00.000Z' } } })
    expect(document.querySelector('[data-state="VERIFIED"]')).toBeTruthy()
    expect(document.querySelector('a[href="https://www.instagram.com/p/x/"]')).toBeTruthy()
  })

  it('Provider 수락만으로는 확인됨으로 보이지 않는다', () => {
    view({ overallStatus: 'ALL_VERIFIED', receipts: { instagram: { channel: 'instagram', stage: 'PROVIDER_ACCEPTED' } } })
    expect(document.querySelector('[data-state="VERIFIED"]')).toBeNull()
    expect(document.querySelector('[data-state="CHECKING"]')).toBeTruthy()
  })

  it('다른 계정에서 확인되면 확인됨으로 올리지 않는다', () => {
    view({ overallStatus: 'ALL_VERIFIED', receipts: { instagram: { channel: 'instagram', stage: 'OUTCOME_OBSERVED', permalink: 'https://www.instagram.com/p/x/', verifiedAt: '2026-10-23T09:00:00.000Z' } } }, '@shop', '@other')
    expect(document.querySelector('[data-state="VERIFIED"]')).toBeNull()
    expect(screen.queryByRole('status')?.textContent ?? '').not.toContain('완료')
  })

  describe('ANI-1681 가짜 행동 버튼 방지', () => {
    it('href 가 있는 링크는 항상 실제 href 를 유지하여 클릭 가능하다', () => {
      view({ overallStatus: 'ALL_VERIFIED', receipts: { instagram: { channel: 'instagram', stage: 'OUTCOME_OBSERVED', permalink: 'https://www.instagram.com/p/verified-link/', verifiedAt: '2026-10-23T09:00:00.000Z' } } })
      const link = document.querySelector('a[href="https://www.instagram.com/p/verified-link/"]')
      expect(link).toBeTruthy()
    })

    it('onAction 미전달 시 href 없는 버튼은 disabled 되고 미연결 상시 안내와 aria-describedby 로 연결된다', () => {
      // UNKNOWN 상태에서 하단 행동은 REFRESH, NEXT_POST 등 href 없는 버튼
      view({ overallStatus: 'FAILED', receipts: { instagram: { channel: 'instagram', stage: 'RESULT_UNKNOWN' } } })

      // 모바일 화면에 상시 보이는 명시적 미연결 텍스트 확인 (focus/hover 없이 상시 가시)
      const notices = screen.getAllByText('일부 동작은 아직 연결되지 않았어요.')
      expect(notices.length).toBeGreaterThan(0)
      const noticeId = notices[0].getAttribute('id')
      expect(noticeId).toBeTruthy()

      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThan(0)
      for (const btn of buttons) {
        expect((btn as HTMLButtonElement).disabled).toBe(true)
        // disabled 버튼이 모바일 안내 텍스트를 aria-describedby 로 가리키는지 확인
        expect(btn.getAttribute('aria-describedby')).toBe(noticeId)
      }
    })

    it('onAction 전달 시 href 없는 버튼은 활성화되고 미연결 안내 문구가 노출되지 않는다', () => {
      const onAction = vi.fn()
      render(
        <ResultScreenView
          input={{ outcome: deriveFirstPostOutcome({ overallStatus: 'FAILED', receipts: { instagram: { channel: 'instagram', stage: 'RESULT_UNKNOWN' } } }), evidence: { instagram: { approvedHandle: '@shop' } } }}
          onAction={onAction}
        />,
      )

      expect(screen.queryByText('일부 동작은 아직 연결되지 않았어요.')).toBeNull()
      const refreshBtn = screen.getByRole('button', { name: '결과 새로고침' }) as HTMLButtonElement
      expect(refreshBtn.disabled).toBe(false)
      expect(refreshBtn.getAttribute('aria-describedby')).toBeNull()
      refreshBtn.click()
      expect(onAction).toHaveBeenCalledTimes(1)
      expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'REFRESH' }))
    })
  })
})
