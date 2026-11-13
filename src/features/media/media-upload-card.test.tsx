import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MediaUploadCard } from './media-upload-card'

describe('owner photo input', () => {
  it('does not pretend a photo exists and explains the no-photo alternative', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) })))
    render(<MediaUploadCard workspaceId="w1" />)
    expect(screen.getByText(/사진이 없으면/)).toBeInTheDocument()
    expect(screen.queryByText('사진 저장 확인')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/직접 촬영했거나 홍보에 사용할 수 있는 사진/)).not.toBeChecked()
  })
  it('asks for confirmation before withdrawing a saved photo and does not promise external deletion', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => init?.method === 'POST' ? { publishEligible: false } : { items: [{ id: 'photo1', rights_status: 'confirmed', publish_eligibility: true }] } }))
    vi.stubGlobal('fetch', fetcher)
    render(<MediaUploadCard workspaceId="w1" />)
    fireEvent.click(await screen.findByRole('button', { name: '사진 공개 사용 중단' }))
    expect(screen.getByText(/이미 게시된 사진은 자동으로 삭제되지 않아요/)).toBeInTheDocument()
    expect(fetcher.mock.calls.some(call => call[1]?.method === 'POST')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '이 사진 사용 중단 확인' }))
    await screen.findByText('사진 저장 확인 · 원본')
    expect(fetcher.mock.calls.some(call => call[1]?.method === 'POST' && JSON.parse(String(call[1]?.body)).action === 'withdraw')).toBe(true)
  })
  it('lets the owner explicitly choose a confirmed original rather than guessing the newest', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => init?.method === 'POST' ? { selected: true } : { items: [{ id: 'photo1', rights_status: 'confirmed', publish_eligibility: true }] } }))
    vi.stubGlobal('fetch', fetcher)
    render(<MediaUploadCard workspaceId="w1" />)
    fireEvent.click(await screen.findByRole('button', { name: '첫 글에 이 사진 사용' }))
    await waitFor(() => expect(fetcher.mock.calls.some(call => call[1]?.method === 'POST' && JSON.parse(String(call[1]?.body)).action === 'select')).toBe(true))
  })
  it('clears stale selection and notice when a selected photo is withdrawn, and explains draft immutability', async () => {
    let items = [{ id: 'photo1', rights_status: 'confirmed', publish_eligibility: true }]
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        if (body.action === 'select') return { ok: true, json: async () => ({ selected: true }) }
        if (body.action === 'withdraw') {
          items = [{ id: 'photo1', rights_status: 'rejected', publish_eligibility: false }]
          return { ok: true, json: async () => ({ publishEligible: false }) }
        }
      }
      return { ok: true, json: async () => ({ items }) }
    })
    vi.stubGlobal('fetch', fetcher)
    render(<MediaUploadCard workspaceId="w1" />)
    expect(screen.getByText('이미 만든 초안은 사진 선택만으로 바뀌지 않아요.')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: '첫 글에 이 사진 사용' }))
    expect(await screen.findByText('첫 글에 이 사진을 사용하도록 선택했어요.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '사진 공개 사용 중단' }))
    fireEvent.click(screen.getByRole('button', { name: '이 사진 사용 중단 확인' }))
    await waitFor(() => {
      expect(screen.queryByText('첫 글에 이 사진을 사용하도록 선택했어요.')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '첫 글에 이 사진 사용 선택됨' })).not.toBeInTheDocument()
    })
  })
  it('hands off only an explicitly confirmed selection and clears it after withdrawal', async () => {
    const selected = vi.fn()
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => init?.method === 'POST' ? JSON.parse(String(init.body)).action === 'select' ? { selected: true } : { publishEligible: false } : { items: [{ id: 'photo1', rights_status: 'confirmed', publish_eligibility: true }] } }))
    vi.stubGlobal('fetch', fetcher)
    render(<MediaUploadCard workspaceId="w1" purpose="draft" requirePhoto onSelectionChange={selected} />)
    fireEvent.click(await screen.findByRole('button', { name: '이 사진 선택' }))
    await waitFor(() => expect(selected).toHaveBeenCalledWith('photo1'))
    fireEvent.click(screen.getByRole('button', { name: '사진 공개 사용 중단' }))
    fireEvent.click(screen.getByRole('button', { name: '이 사진 사용 중단 확인' }))
    await waitFor(() => expect(selected).toHaveBeenLastCalledWith(null))
  })
  it('invalidates a draft photo selection immediately when a different file is picked', async () => {
    const selected = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => init?.method === 'POST' ? { selected: true } : { items: [{ id: 'photo1', rights_status: 'confirmed', publish_eligibility: true }] } })))
    render(<MediaUploadCard workspaceId="w1" purpose="draft" requirePhoto onSelectionChange={selected} />)
    fireEvent.click(await screen.findByRole('button', { name: '이 사진 선택' }))
    await waitFor(() => expect(selected).toHaveBeenLastCalledWith('photo1'))
    fireEvent.change(screen.getByLabelText('가게 사진 고르기'), { target: { files: [new File(['png'], 'new.png', { type: 'image/png' })] } })
    expect(selected).toHaveBeenLastCalledWith(null)
  })
  it('does not claim selected after an empty success response', async () => {
    const selected = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => init?.method === 'POST' ? {} : { items: [{ id: 'photo1', rights_status: 'confirmed', publish_eligibility: true }] } })))
    render(<MediaUploadCard workspaceId="w1" onSelectionChange={selected} />)
    fireEvent.click(await screen.findByRole('button', { name: '첫 글에 이 사진 사용' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('사진 선택 저장을 확인하지 못했어요')
    expect(selected).not.toHaveBeenCalled()
  })
  it('requires fresh rights and person consent confirmation for a newly chosen file', () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [] })))
    render(<MediaUploadCard workspaceId="w1" />)
    const picker = screen.getByLabelText('가게 사진 고르기')
    fireEvent.change(picker, { target: { files: [new File(['a'], 'a.png', { type: 'image/png' })] } })
    fireEvent.click(screen.getByLabelText('직접 촬영했거나 홍보에 사용할 수 있는 사진이에요.'))
    fireEvent.change(screen.getByLabelText('알아볼 수 있는 사람이 있나요?'), { target: { value: 'consented' } })
    fireEvent.change(screen.getByLabelText('보관 중인 동의 근거의 관리번호'), { target: { value: 'agreement-a' } })
    fireEvent.change(picker, { target: { files: [new File(['b'], 'b.png', { type: 'image/png' })] } })
    expect(screen.getByLabelText('직접 촬영했거나 홍보에 사용할 수 있는 사진이에요.')).not.toBeChecked()
    expect(screen.getByLabelText('알아볼 수 있는 사람이 있나요?')).toHaveValue('unknown')
    expect(screen.queryByLabelText('보관 중인 동의 근거의 관리번호')).toBeNull()
  })

  it('rejects HEIC clearly without calling an upload endpoint', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) }))
    vi.stubGlobal('fetch', fetcher)
    render(<MediaUploadCard workspaceId="w1" />)
    fireEvent.change(screen.getByLabelText('가게 사진 고르기'), { target: { files: [new File(['heic'], 'photo.heic', { type: 'image/heic' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('JPG 또는 PNG')
    expect(fetcher.mock.calls.some(call => (call as any)[1]?.method === 'POST')).toBe(false)
  })

  it('does not display credit usage note in no-photo AI alternative', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) })))
    render(<MediaUploadCard workspaceId="w1" />)
    expect(screen.getByText('원본 사진을 사용하지 않고 새로운 AI 이미지를 생성해요.')).toBeInTheDocument()
    expect(screen.queryByText(/크레딧/)).not.toBeInTheDocument()
  })

  it('24MP·HEIC 변환 기술 문구를 노출하지 않고 체크박스가 1줄로 간소화된다', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) })))
    render(<MediaUploadCard workspaceId="w1" />)
    expect(screen.queryByText(/24MP 이하 사진을 이 기기에서 JPG로 변환/)).not.toBeInTheDocument()
    expect(screen.getByText('스마트폰 사진 모두 가능 (최대 10MB)')).toBeInTheDocument()
    expect(screen.getByLabelText('직접 촬영했거나 홍보에 사용할 수 있는 사진이에요.')).toBeInTheDocument()
  })
})
