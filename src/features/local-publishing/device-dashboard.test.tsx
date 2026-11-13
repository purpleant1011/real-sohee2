import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./actions/create-pairing-code', () => ({ createPairingCodeAction: vi.fn() }))
vi.mock('./actions/revoke-device', () => ({ revokeDeviceAction: vi.fn() }))

import { DeviceDashboard } from './device-dashboard'

const device = {
  id: '10000000-0000-4000-8000-000000000001',
  displayName: '업무용 Chrome',
  platform: 'macos',
  clientVersion: '0.1.0',
  status: 'active',
  lastSeenAt: '2026-08-19T07:00:00.000Z',
} as const

describe('local publishing device dashboard', () => {
  it('shows target account and revocation without password or cookie inputs', () => {
    render(<DeviceDashboard
      devices={[device]}
      connections={[{
        id: '10000000-0000-4000-8000-000000000002',
        deviceId: device.id,
        channel: 'naver_blog',
        accountLabel: 'findk3',
        targetUrl: 'https://blog.naver.com/findk3',
        environment: 'test',
        status: 'connected',
        lastSeenAt: '2026-08-19T07:00:00.000Z',
      }]}
    />)

    expect(screen.getByText('findk3')).toBeInTheDocument()
    expect(screen.queryByText('게시 준비')).not.toBeInTheDocument()
    expect(screen.getByText('연결됨')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '기기 연결 해제' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/비밀번호|쿠키/u)).not.toBeInTheDocument()
  })

  it('explains that a pairing code expires and does not collect provider credentials', () => {
    render(<DeviceDashboard devices={[]} connections={[]} />)
    expect(screen.getByRole('button', { name: '브라우저 연결 코드 만들기' })).toBeInTheDocument()
    expect(screen.getByText(/10분/u)).toBeInTheDocument()
    expect(screen.getByText(/네이버와 당근 로그인은 PC 브라우저에서 직접/u)).toBeInTheDocument()
  })

  it('keeps the newest active device visible and folds older duplicate records', () => {
    const older = { ...device, id: '10000000-0000-4000-8000-000000000009', lastSeenAt: '2026-08-19T06:00:00.000Z' }
    render(<DeviceDashboard devices={[device, older]} connections={[]} manualPairingCollapsed />)

    expect(screen.getByRole('heading', { name: '현재 게시 기기' })).toBeInTheDocument()
    expect(screen.getByText('이전 연결 1개 보기')).toBeInTheDocument()
    expect(screen.getAllByText('업무용 Chrome')).toHaveLength(1)
  })
})
