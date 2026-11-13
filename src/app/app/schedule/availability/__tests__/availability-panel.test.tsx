import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AvailabilityPanel } from '../availability-panel'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

const SERVICE = {
  id: '22222222-2222-4222-8222-222222222222',
  workspaceId: WORKSPACE_ID,
  name: '맞춤 커트',
  price: 35000,
  active: true,
  updatedAt: '2026-10-15T00:00:00.000Z',
  durationMinutes: 60,
}

function mockFetch(payload: { services?: unknown[]; slots?: unknown[] }, ok = true) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => (ok ? { services: payload.services ?? [], slots: payload.slots ?? [] } : { error: '조회 실패' }),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('ANI-1610 AvailabilityPanel mount', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mounts the previously orphaned AvailabilityForm behind the panel', async () => {
    mockFetch({ services: [SERVICE], slots: [] })

    render(<AvailabilityPanel workspaceId={WORKSPACE_ID} timezone="Asia/Seoul" />)

    await waitFor(() => {
      expect(screen.getByLabelText('가용 시간 확인 폼')).toBeInTheDocument()
    })
  })

  it('shows 확인 필요 instead of an availability claim when nothing was observed', async () => {
    mockFetch({ services: [SERVICE], slots: [] })

    render(<AvailabilityPanel workspaceId={WORKSPACE_ID} timezone="Asia/Seoul" />)

    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('확인 필요')
    expect(document.body.textContent).not.toContain('예약 가능합니다')
  })

  it('shows the last confirmation time and source when a fresh owner-confirmed slot exists', async () => {
    mockFetch({
      services: [SERVICE],
      slots: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          workspaceId: WORKSPACE_ID,
          serviceId: SERVICE.id,
          startsAt: '2026-10-24T06:00:00.000Z',
          endsAt: '2026-10-24T07:00:00.000Z',
          timezone: 'Asia/Seoul',
          confirmedBy: '44444444-4444-4444-8444-444444444444',
          confirmedAt: new Date().toISOString(),
          validUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          version: 1,
          status: 'AVAILABLE',
        },
      ],
    })

    render(<AvailabilityPanel workspaceId={WORKSPACE_ID} timezone="Asia/Seoul" />)

    const notice = await screen.findByRole('status')
    await waitFor(() => {
      expect(notice).not.toHaveTextContent('확인 필요')
    })
    expect(notice).toHaveTextContent('사장님 직접 확인')
  })

  it('does not pretend success when the ledger read fails', async () => {
    mockFetch({}, false)

    render(<AvailabilityPanel workspaceId={WORKSPACE_ID} timezone="Asia/Seoul" />)

    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('확인 필요')
    expect(screen.queryByLabelText('가용 시간 확인 폼')).toBeNull()
  })
})
