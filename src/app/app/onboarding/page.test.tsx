import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
  FirstWowFlow: vi.fn(() => null),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}))

vi.mock('@/features/onboarding/first-wow-flow', () => ({
  FirstWowFlow: mocks.FirstWowFlow,
}))

vi.mock('@/features/auth/current-workspace', () => ({
  getCurrentWorkspaceContext: vi.fn().mockResolvedValue({ workspaceId: 'ws-test' }),
}))

import OnboardingPage from './page'

describe('Legacy /app/onboarding Compatibility Redirect (ANI-1464, ANI-1502 → /start)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to the guided /start flow without rendering legacy FirstWowFlow', async () => {
    await expect(OnboardingPage({})).rejects.toThrow('NEXT_REDIRECT:/start')
    expect(mocks.FirstWowFlow).not.toHaveBeenCalled()
  })

  it('preserves search query parameters when redirecting to /start', async () => {
    await expect(
      OnboardingPage({
        searchParams: Promise.resolve({ step: 'channels', reason: 'resume' }),
      })
    ).rejects.toThrow('NEXT_REDIRECT:/start?step=channels&reason=resume')
    expect(mocks.FirstWowFlow).not.toHaveBeenCalled()
  })
})
