// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LiveRegion, MobileSheet, TOUCH_MIN_PX, TOUCH_TARGET_CLASS } from './index'

afterEach(cleanup)

function Harness({ description }: { description?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>열기</button>
      <MobileSheet open={open} onOpenChange={setOpen} title="게시 확인" description={description}>
        <input aria-label="메모" />
      </MobileSheet>
    </>
  )
}

describe('접근성 컴포넌트 계약 (ANI-1667)', () => {
  describe('Given 터치 대상 계약', () => {
    it('Then 최소 44px(min-h-11)로 고정된다', () => {
      expect(TOUCH_MIN_PX).toBe(44)
      expect(TOUCH_TARGET_CLASS).toContain('min-h-11')
      expect(TOUCH_TARGET_CLASS).toContain('min-w-11')
    })
  })

  describe('Given MobileSheet 이 열릴 때', () => {
    it('Then 제목으로 이름 붙은 dialog 안으로 포커스가 이동한다', async () => {
      render(<Harness />)
      fireEvent.click(screen.getByRole('button', { name: '열기' }))
      const dialog = screen.getByRole('dialog', { name: '게시 확인' })
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    })
    it('Then 닫기 버튼은 이름이 있고 44px 터치 대상이다', () => {
      render(<Harness />)
      fireEvent.click(screen.getByRole('button', { name: '열기' }))
      const close = screen.getByRole('button', { name: '닫기' })
      expect(close.className).toContain('min-h-11')
      expect(close.className).toContain('min-w-11')
    })
    it('Then 설명이 있으면 dialog 에 연결된다', () => {
      render(<Harness description="게시 전에 확인해 주세요" />)
      fireEvent.click(screen.getByRole('button', { name: '열기' }))
      expect(screen.getByRole('dialog', { name: '게시 확인' })).toHaveAccessibleDescription('게시 전에 확인해 주세요')
    })
  })

  describe('When Esc 로 닫으면', () => {
    it('Then dialog 가 사라지고 포커스가 트리거로 돌아간다', async () => {
      render(<Harness />)
      const trigger = screen.getByRole('button', { name: '열기' })
      trigger.focus()
      fireEvent.click(trigger)
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      await waitFor(() => expect(document.activeElement).toBe(trigger))
    })
  })

  describe('LiveRegion', () => {
    it('polite 는 role=status, 시각적으로 숨겨진 채 메시지를 알린다', () => {
      render(<LiveRegion message="저장했어요" />)
      const el = screen.getByRole('status')
      expect(el).toHaveAttribute('aria-live', 'polite')
      expect(el.className).toContain('sr-only')
      expect(el.textContent).toBe('저장했어요')
    })
    it('assertive 는 role=alert', () => {
      render(<LiveRegion message="저장 실패" politeness="assertive" />)
      expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive')
    })
    it('메시지가 비어도 컨테이너는 유지된다(읽히려면 항상 마운트)', () => {
      render(<LiveRegion message="" />)
      expect(screen.getByRole('status')).toBeTruthy()
    })
  })
})
