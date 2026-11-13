import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NaverPostUrlForm } from './naver-post-url-form'

const props = { workspaceId: 'workspace-a', itemId: '11111111-1111-4111-8111-111111111111' }
const okUrl = 'https://blog.naver.com/myshop/223456789012'

function type(value: string) {
  fireEvent.change(screen.getByLabelText('올린 글 주소'), { target: { value } })
}

describe('NaverPostUrlForm', () => {
  it('rejects anything that is not a naver blog post address without calling the server', () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    render(<NaverPostUrlForm {...props} fetcher={fetcher} />)
    type('https://evil.example/myshop/223456789012')
    fireEvent.click(screen.getByRole('button', { name: '올린 글 주소 기록' }))
    expect(screen.getByRole('alert')).toHaveTextContent('네이버 블로그 글 주소')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('registers the address on the vault item and says it is not verified', async () => {
    const fetcher = vi.fn(async () => Response.json({
      success: true, publishedUrl: okUrl, statusLabel: '사장님이 직접 올린 글로 기록됐어요(확인 전)', registeredAt: '2026-10-28T10:00:00Z',
    })) as unknown as typeof fetch
    render(<NaverPostUrlForm {...props} fetcher={fetcher} />)
    type(` ${okUrl} `)
    fireEvent.click(screen.getByRole('button', { name: '올린 글 주소 기록' }))
    expect(await screen.findByRole('status')).toHaveTextContent('사장님이 직접 올린 글로 기록됐어요(확인 전)')
    expect(screen.getByRole('status')).toHaveTextContent('실제 게시를 확인한 것은 아니에요')
    expect(fetcher).toHaveBeenCalledWith(`/api/workspaces/workspace-a/vault/${props.itemId}/bundle`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ url: okUrl }),
    }))
  })

  it('shows the server message and never a success when registration fails', async () => {
    const fetcher = vi.fn(async () => Response.json({ error: '이 매장에서는 기록할 수 없어요.' }, { status: 403 })) as unknown as typeof fetch
    render(<NaverPostUrlForm {...props} fetcher={fetcher} />)
    type(okUrl)
    fireEvent.click(screen.getByRole('button', { name: '올린 글 주소 기록' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('이 매장에서는 기록할 수 없어요.')
    expect(screen.queryByRole('status')).toBeNull()
  })
})
