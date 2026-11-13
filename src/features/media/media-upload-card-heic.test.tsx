import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MediaUploadCard } from './media-upload-card'

const convert = vi.hoisted(() => vi.fn())
vi.mock('./heic-conversion', () => ({
  isHeicPhoto: (file: File) => /\.heic$/i.test(file.name),
  convertHeicPhoto: convert,
}))
beforeEach(() => {
  convert.mockReset()
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [] })))
})
it('prepares HEIC locally before enabling save and explains JPEG storage', async () => {
  let finish!: (file: File) => void
  convert.mockImplementation(() => new Promise<File>(resolve => { finish = resolve }))
  render(<MediaUploadCard workspaceId="w1" />)
  fireEvent.change(screen.getByLabelText('가게 사진 고르기'), { target: { files: [new File(['heic'], 'a.heic', { type: 'image/heic' })] } })
  expect(await screen.findByText('HEIC 사진을 이 기기에서 JPG로 변환 중…')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '사진 저장하기' })).toBeDisabled()
  await act(async () => finish(new File(['jpeg'], 'a.jpg', { type: 'image/jpeg' })))
  expect(await screen.findByText('HEIC 원본 대신 이 기기에서 변환한 JPG를 저장해요.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '사진 저장하기' })).toBeEnabled()
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
})
it('allows cancelling local conversion without upload or enabling save from a late result', async () => {
  let finish!: (file: File) => void
  let signal!: AbortSignal
  convert.mockImplementation((_file, options) => { signal = options.signal; return new Promise<File>(resolve => { finish = resolve }) })
  render(<MediaUploadCard workspaceId="w1" />)
  fireEvent.change(screen.getByLabelText('가게 사진 고르기'), { target: { files: [new File(['heic'], 'a.heic')] } })
  fireEvent.click(await screen.findByRole('button', { name: '변환 취소' }))
  expect(signal.aborted).toBe(true)
  await act(async () => finish(new File(['jpeg'], 'a.jpg', { type: 'image/jpeg' })))
  expect(screen.getByRole('button', { name: '사진 저장하기' })).toBeDisabled()
})
it('provides a recoverable conversion failure without a server write', async () => {
  convert.mockRejectedValue(new Error('HEIC_INVALID'))
  render(<MediaUploadCard workspaceId="w1" />)
  fireEvent.change(screen.getByLabelText('가게 사진 고르기'), { target: { files: [new File(['broken'], 'a.heic')] } })
  expect(await screen.findByRole('alert')).toHaveTextContent('JPG 또는 PNG로 다시 선택해 주세요')
  expect(screen.getByLabelText('가게 사진 고르기')).toBeEnabled()
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true))
})
