import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { SoheeLiveWorkboard } from './sohee-live-workboard'

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => null })))

describe('SoheeLiveWorkboard 모바일 표현', () => {
  it('모바일에서는 접힌 "업무 현황" 한 줄로 시작하고 펼치면 전체 현황이 나온다', () => {
    const { container } = render(<MobileR2Provider enabled forceMobile><SoheeLiveWorkboard workspaceId="ws" /></MobileR2Provider>)
    const details = container.querySelector('details')
    expect(details).not.toBeNull()
    expect(details!.hasAttribute('open')).toBe(false)
    expect(screen.getByText('업무 현황 보기')).toBeInTheDocument()
    expect(details!.querySelector('section[aria-label="소희의 자세한 업무 현황"]')).not.toBeNull()
  })
  it('PC에서는 기존처럼 바로 펼쳐 보인다', () => {
    const { container } = render(<SoheeLiveWorkboard workspaceId="ws" />)
    expect(container.querySelector('details')).toBeNull()
    expect(screen.getByLabelText('소희의 자세한 업무 현황')).toBeInTheDocument()
  })
})
