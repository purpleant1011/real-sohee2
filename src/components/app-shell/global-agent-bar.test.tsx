import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { GlobalAgentBar } from './global-agent-bar'

describe('GlobalAgentBar', () => {
  it('does not render credit budget gauge, percentages, or credit units', () => {
    render(
      <GlobalAgentBar
        workspaceName="미소 헤어"
        currentCredits={150}
        totalCredits={300}
      />,
    )

    expect(screen.getByText('미소 헤어')).toBeInTheDocument()
    expect(screen.queryByText('업무 예산')).not.toBeInTheDocument()
    expect(screen.queryByText(/150/)).not.toBeInTheDocument()
    expect(screen.queryByText(/300/)).not.toBeInTheDocument()
    expect(screen.queryByText(/50%/)).not.toBeInTheDocument()
    expect(screen.queryByText(/C\)/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/크레딧/)).not.toBeInTheDocument()
  })
})
