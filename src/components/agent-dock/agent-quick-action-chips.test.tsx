import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgentQuickActionChips } from './agent-quick-action-chips'

describe('AgentQuickActionChips Component', () => {
  it('renders chips and triggers onSelectChip when clicked', () => {
    const handleSelect = vi.fn()
    render(
      <AgentQuickActionChips
        chips={['💡 1인샵 후속 글 작성', '📊 오늘 성과 분석']}
        onSelectChip={handleSelect}
      />
    )

    const chip1 = screen.getByRole('button', { name: /1인샵 후속 글 작성/i })
    expect(chip1).toBeDefined()

    fireEvent.click(chip1)
    expect(handleSelect).toHaveBeenCalledWith('💡 1인샵 후속 글 작성')
  })

  it('renders nothing when chips array is empty', () => {
    const { container } = render(
      <AgentQuickActionChips chips={[]} onSelectChip={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })
})
