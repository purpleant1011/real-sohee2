import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DetailPanel } from './detail-panel'

function DetailPanelHarness() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        근거 보기
      </button>
      <DetailPanel open={open} onOpenChange={setOpen} title="확인 근거" description="이 계획에 사용한 자료예요.">
        <button type="button">자료 열기</button>
      </DetailPanel>
    </>
  )
}

describe('DetailPanel', () => {
  it('moves focus into the panel and restores it after Escape', async () => {
    render(<DetailPanelHarness />)
    const opener = screen.getByRole('button', { name: '근거 보기' })

    opener.focus()
    fireEvent.click(opener)

    const panel = screen.getByRole('dialog', { name: '확인 근거' })
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true))
    expect(screen.getByText('이 계획에 사용한 자료예요.')).toBeVisible()

    fireEvent.keyDown(panel, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('closes from the visible close button and backdrop', async () => {
    render(<DetailPanelHarness />)

    fireEvent.click(screen.getByRole('button', { name: '근거 보기' }))
    fireEvent.click(screen.getByRole('button', { name: '상세 정보 닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '근거 보기' }))
    fireEvent.mouseDown(screen.getByTestId('detail-panel-backdrop'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('locks document scrolling while open and restores it on close', async () => {
    document.documentElement.style.overflow = 'clip'
    document.body.style.overflow = 'scroll'
    render(<DetailPanelHarness />)

    fireEvent.click(screen.getByRole('button', { name: '근거 보기' }))
    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.click(screen.getByRole('button', { name: '상세 정보 닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.documentElement.style.overflow).toBe('clip')
    expect(document.body.style.overflow).toBe('scroll')

    document.documentElement.style.overflow = ''
    document.body.style.overflow = ''
  })
})
