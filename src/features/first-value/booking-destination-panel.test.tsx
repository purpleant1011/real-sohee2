import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BookingDestinationPanel } from './booking-destination-panel'

const empty = { configuration: null, destination: { kind: 'NOT_CONFIGURED', href: null, label: '고객이 문의할 주소를 먼저 설정해 주세요.', networkVerified: false } }
const configured = { configuration: { revision: 1, bookingUrl: 'https://booking.example.com/shop-a', bookingExpiresAt: null }, destination: { kind: 'BOOKING_URL', href: 'https://booking.example.com/shop-a', label: '사장님이 확인한 예약 링크', networkVerified: false } }

describe('owner booking destination panel', () => {
  it('requires owner confirmation, reloads a saved destination and explicitly applies it to the draft', async () => {
    let stored = false
    const fetcher = vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'POST') stored = true
      return Response.json(stored ? configured : empty)
    }) as unknown as typeof fetch
    const apply = vi.fn().mockResolvedValue(undefined)
    render(<BookingDestinationPanel workspaceId="workspace-a" onApply={apply} fetcher={fetcher} />)
    const input = await screen.findByRole('textbox', { name: '예약 주소' })
    fireEvent.change(input, { target: { value: 'https://booking.example.com/shop-a' } })
    const save = screen.getByRole('button', { name: '예약 주소 저장' })
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: '우리 가게 예약 페이지와 공개 가능한 주소를 직접 확인했어요' }))
    fireEvent.click(save)
    const applyButton = await screen.findByRole('button', { name: '이 주소를 글에 추가' })
    expect(apply).not.toHaveBeenCalled()
    fireEvent.click(applyButton)
    await waitFor(() => expect(apply).toHaveBeenCalledWith(configured.destination.href))
    const post = (fetcher as any).mock.calls.find(([, options]: [unknown, RequestInit]) => options?.method === 'POST')
    expect(JSON.parse(post[1].body)).toMatchObject({ expectedRevision: 0, bookingUrl: configured.destination.href, confirmed: true })
    expect(JSON.parse(post[1].body)).not.toHaveProperty('workspaceId')
    expect(screen.getByText('접속 상태를 자동으로 확인한 것은 아니에요. 공유 전 실제 예약 페이지를 다시 확인해 주세요.')).toBeInTheDocument()
  })

  it('preserves an existing expiry rather than silently removing it on confirmation', async () => {
    const bookingExpiresAt = '2099-10-22T09:30:00.000Z'
    const existing = { ...configured, configuration: { ...configured.configuration, bookingExpiresAt } }
    let saved = false
    const fetcher = vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'POST') saved = true
      return Response.json(saved ? { ...existing, configuration: { ...existing.configuration, revision: 2 } } : existing)
    }) as unknown as typeof fetch
    render(<BookingDestinationPanel workspaceId="workspace-a" onApply={vi.fn()} fetcher={fetcher} />)
    await screen.findByRole('textbox', { name: '예약 주소' })
    fireEvent.click(screen.getByRole('checkbox', { name: '우리 가게 예약 페이지와 공개 가능한 주소를 직접 확인했어요' }))
    fireEvent.click(screen.getByRole('button', { name: '예약 주소 저장' }))
    await waitFor(() => expect((fetcher as any).mock.calls.some(([, options]: [unknown, RequestInit]) => options?.method === 'POST')).toBe(true))
    const call = (fetcher as any).mock.calls.find(([, options]: [unknown, RequestInit]) => options?.method === 'POST')
    expect(JSON.parse(call[1].body).bookingExpiresAt).toBe(bookingExpiresAt)
  })

  it('does not apply the old saved link after the owner edits the visible URL', async () => {
    const fetcher = vi.fn(async () => Response.json(configured)) as unknown as typeof fetch
    const apply = vi.fn().mockResolvedValue(undefined)
    render(<BookingDestinationPanel workspaceId="workspace-a" onApply={apply} fetcher={fetcher} />)
    const input = await screen.findByRole('textbox', { name: '예약 주소' })
    fireEvent.change(input, { target: { value: 'https://booking.example.com/shop-b' } })
    const button = screen.getByRole('button', { name: '이 주소를 글에 추가' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(apply).not.toHaveBeenCalled()
  })

  it('does not apply a destination changed on the server after it was reviewed', async () => {
    let reads = 0
    const changed = { configuration: { revision: 2, bookingUrl: 'https://booking.example.com/shop-b', bookingExpiresAt: null }, destination: { ...configured.destination, href: 'https://booking.example.com/shop-b' } }
    const fetcher = vi.fn(async () => Response.json(++reads === 1 ? configured : changed)) as unknown as typeof fetch
    const apply = vi.fn().mockResolvedValue(undefined)
    render(<BookingDestinationPanel workspaceId="workspace-a" onApply={apply} fetcher={fetcher} />)
    fireEvent.click(await screen.findByRole('button', { name: '이 주소를 글에 추가' }))
    expect(await screen.findByText('예약 주소가 변경되었어요. 최신 내용을 다시 확인해 주세요.')).toBeInTheDocument()
    expect(apply).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: '예약 주소' })).toHaveValue(changed.configuration.bookingUrl)
  })

  it('does not acknowledge an empty HTTP 200 response as a saved setting', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => Response.json(options?.method === 'POST' ? {} : empty)) as unknown as typeof fetch
    render(<BookingDestinationPanel workspaceId="workspace-a" onApply={vi.fn()} fetcher={fetcher} />)
    fireEvent.change(await screen.findByRole('textbox', { name: '예약 주소' }), { target: { value: configured.destination.href } })
    fireEvent.click(screen.getByRole('checkbox', { name: '우리 가게 예약 페이지와 공개 가능한 주소를 직접 확인했어요' }))
    fireEvent.click(screen.getByRole('button', { name: '예약 주소 저장' }))
    expect(await screen.findByText('예약 주소 저장 기록을 확인하지 못했어요.')).toBeInTheDocument()
    expect(screen.queryByText('예약 주소 설정을 저장하고 다시 확인했어요. 글에 넣기 전 내용을 확인해 주세요.')).not.toBeInTheDocument()
  })

  it('does not call a failed lookup an empty configuration', async () => {
    const fetcher = vi.fn(async () => Response.json({ error: '예약 주소를 조회하지 못했어요.' }, { status: 503 })) as unknown as typeof fetch
    render(<BookingDestinationPanel workspaceId="workspace-a" onApply={vi.fn()} fetcher={fetcher} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('예약 주소를 조회하지 못했어요.')
    expect(screen.queryByText('설정된 예약 주소가 없어요.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이 주소를 글에 추가' })).not.toBeInTheDocument()
  })

  it('reuses the command ID after an uncertain save instead of creating a second command', async () => {
    let attempts = 0
    const commands: any[] = []
    const fetcher = vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'POST') {
        commands.push(JSON.parse(String(options.body)))
        attempts++
        if (attempts === 1) return Response.json({ error: '저장 결과를 확인하지 못했어요.' }, { status: 503 })
      }
      return Response.json(attempts > 1 ? configured : empty)
    }) as unknown as typeof fetch
    render(<BookingDestinationPanel workspaceId="workspace-a" onApply={vi.fn()} fetcher={fetcher} />)
    fireEvent.change(await screen.findByRole('textbox', { name: '예약 주소' }), { target: { value: configured.destination.href } })
    fireEvent.click(screen.getByRole('checkbox', { name: '우리 가게 예약 페이지와 공개 가능한 주소를 직접 확인했어요' }))
    fireEvent.click(screen.getByRole('button', { name: '예약 주소 저장' }))
    expect(await screen.findByText('저장 결과를 확인하지 못했어요.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '예약 주소 저장' }))
    expect(await screen.findByRole('button', { name: '이 주소를 글에 추가' })).toBeInTheDocument()
    expect(commands).toHaveLength(2)
    expect(commands[0].commandId).toBe(commands[1].commandId)
    expect(commands[0].expectedRevision).toBe(commands[1].expectedRevision)
  })
})
