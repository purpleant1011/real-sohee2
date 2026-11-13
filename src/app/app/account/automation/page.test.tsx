import { describe, expect, it, vi } from 'vitest'
import AccountAutomationPage from './page'

const redirectMock = vi.fn()
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}))

describe('AccountAutomationPage (/app/account/automation)', () => {
  it('올바른 정식 자동화 설정 경로(/app/settings/automation)로 리다이렉트한다', async () => {
    await AccountAutomationPage()
    expect(redirectMock).toHaveBeenCalledWith('/app/settings/automation')
  })
})
