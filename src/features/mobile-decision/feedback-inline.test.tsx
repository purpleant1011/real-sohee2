import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { FeedbackLauncher } from '@/features/feedback/FeedbackLauncher'
it('places feedback in the more menu instead of covering mobile content', () => {
  render(<FeedbackLauncher workspaceId="fixture" pathname="/app/system" inline />)
  expect(screen.getByRole('button', { name: '의견 보내기' }).className).not.toContain('fixed')
})
