import { describe, expect, it, vi } from 'vitest'
import AccountChannelsPage from './page'

const redirectMock = vi.fn()
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}))

describe('AccountChannelsPage (/app/account/channels)', () => {
  it('올바른 채널 관리 경로(/app/channels)로 리다이렉트한다', () => {
    AccountChannelsPage()
    expect(redirectMock).toHaveBeenCalledWith('/app/channels')
  })
})
