import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StartWizard } from '../start-wizard'
const navigation = vi.hoisted(() => ({ router: { push: vi.fn() }, search: { get: () => null } }))
vi.mock('next/navigation', () => ({ useRouter: () => navigation.router, useSearchParams: () => navigation.search }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
const fetcher = vi.fn()
beforeEach(() => {
  vi.stubGlobal('fetch', fetcher)
  fetcher.mockImplementation(async (_url, init) => ({ ok: true, json: async () => init?.method === 'POST'
    ? { summary: { name: '실제 가게', roadAddress: '서울', category: '카페', visitorReviewScore: null, visitorReviewCount: null } }
    : { workspaceId: 'w1', profile: { business_name: '가입한 가게', industry: '카페·디저트', summary: '' }, facts: {}, progressPercent: 0 } }))
})
describe('start owner fact truth', () => {
  it('reuses signup name and explains the existing channel-gated starter benefit policy without credit mention', async () => {
    render(<StartWizard />)
    expect(await screen.findByDisplayValue('가입한 가게')).toBeInTheDocument()
    expect(screen.getByText(/SNS 1곳 연결 시 첫 포스팅 무료 혜택/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '채널 연결하러 가기' })).toBeInTheDocument()
    expect(screen.queryByText(/시작 크레딧/)).toBeNull()
  })
  it('saves incomplete owner input without generating or requiring a connected channel', async () => {
    render(<StartWizard />)
    await screen.findByDisplayValue('가입한 가게')
    fireEvent.change(screen.getByLabelText('우리 가게를 한두 문장으로 소개해 주세요'), { target: { value: '직접 만드는 커피' } })
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH' && JSON.parse(init.body).summary === '직접 만드는 커피')).toBe(true), { timeout: 2500 })
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('first-value'))).toBe(false)
  })
  it('네이버 플레이스 자동 채우기 배너를 노출하지 않고 직접 입력을 유도한다', async () => {
    render(<StartWizard />)
    await screen.findByDisplayValue('가입한 가게')
    expect(screen.queryByText(/네이버 지도\(스마트플레이스\) 링크로 정보 자동 채우기/)).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('예: https://naver.me/5xgJJEBa')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /사업자·운영 정보 직접 입력/ })).toBeInTheDocument()
  })
})
