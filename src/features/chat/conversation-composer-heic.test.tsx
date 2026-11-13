import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ConversationComposer } from './conversation-composer'

const convert = vi.hoisted(() => vi.fn())
vi.mock('@/features/media/heic-conversion', () => ({ isHeicPhoto: (file: File) => /\.heic$/i.test(file.name), convertHeicPhoto: convert }))
beforeEach(() => { convert.mockReset() })
function choose() {
  fireEvent.click(screen.getByRole('button', { name: '이미지 첨부 열기' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '첨부 이미지 사용 권리를 확인했습니다' }))
  fireEvent.change(screen.getByLabelText('이미지 첨부'), { target: { files: [new File(['heic'], 'IMG.HEIC')] } })
}
it('uploads the locally converted JPEG, not the HEIC source, after explicit rights confirmation', async () => {
  const jpg = new File(['jpeg'], 'IMG.jpg', { type: 'image/jpeg' })
  convert.mockResolvedValue(jpg)
  const upload = vi.fn<(source: FormData) => Promise<{ data: { assetId: string; rightsStatus: 'confirmed' } }>>(async () => ({ data: { assetId: 'photo-id', rightsStatus: 'confirmed' } }))
  render(<ConversationComposer workspaceId="w1" uploadMedia={upload} onSubmit={vi.fn()} />)
  choose()
  await waitFor(() => expect(upload).toHaveBeenCalledOnce())
  expect(upload.mock.calls[0][0].get('file')).toBe(jpg)
  expect(await screen.findByText('HEIC 원본 대신 변환한 JPG를 첨부했어요.')).toBeInTheDocument()
})
it('does not upload after the workspace changes during local conversion', async () => {
  let finish!: (file: File) => void
  convert.mockImplementation(() => new Promise<File>(resolve => { finish = resolve }))
  const upload = vi.fn(), changed = vi.fn()
  const props = { uploadMedia: upload, onSubmit: vi.fn(), onAttachmentIdsChange: changed }
  const { rerender } = render(<ConversationComposer {...props} workspaceId="w1" />)
  choose()
  await waitFor(() => expect(convert).toHaveBeenCalledOnce())
  rerender(<ConversationComposer {...props} workspaceId="w2" />)
  await act(async () => finish(new File(['jpeg'], 'IMG.jpg', { type: 'image/jpeg' })))
  expect(upload).not.toHaveBeenCalled()
  expect(changed).not.toHaveBeenCalledWith(['photo-id'])
})
it('does not restore a cleared attachment after a late local conversion', async () => {
  let finish!: (file: File) => void
  convert.mockImplementation(() => new Promise<File>(resolve => { finish = resolve }))
  const upload = vi.fn<(source: FormData) => Promise<{ data: { assetId: string; rightsStatus: 'confirmed' } }>>(async () => ({ data: { assetId: 'photo-id', rightsStatus: 'confirmed' } }))
  const props = { workspaceId: 'w1', uploadMedia: upload, onSubmit: vi.fn() }
  const { rerender } = render(<ConversationComposer {...props} />)
  choose()
  await waitFor(() => expect(convert).toHaveBeenCalledOnce())
  rerender(<ConversationComposer {...props} clearAttachmentToken={1} />)
  await act(async () => finish(new File(['jpeg'], 'IMG.jpg', { type: 'image/jpeg' })))
  expect(upload).not.toHaveBeenCalled()
  expect(screen.queryByText('1장 첨부됨')).toBeNull()
})
it('preserves message text and skips upload when local conversion fails', async () => {
  convert.mockRejectedValue(new Error('HEIC_INVALID'))
  const upload = vi.fn()
  render(<ConversationComposer workspaceId="w1" uploadMedia={upload} onSubmit={vi.fn()} />)
  fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), { target: { value: '이 사진으로 만들어줘' } })
  choose()
  expect(await screen.findByRole('alert')).toHaveTextContent('JPG 또는 PNG')
  expect(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })).toHaveValue('이 사진으로 만들어줘')
  expect(upload).not.toHaveBeenCalled()
})
