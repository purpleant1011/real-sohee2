import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ConversationComposer, type ComposerSubmit } from './conversation-composer'

function confirmImageRights() {
  if (!screen.queryByRole('checkbox', { name: '첨부 이미지 사용 권리를 확인했습니다' })) {
    fireEvent.click(screen.getByRole('button', { name: '이미지 첨부 열기' }))
  }
  fireEvent.click(screen.getByRole('checkbox', { name: '첨부 이미지 사용 권리를 확인했습니다' }))
}

describe('ConversationComposer', () => {
  it('keeps text-only chat compact and asks image rights only in the attachment flow', () => {
    render(<ConversationComposer onSubmit={vi.fn()} workspaceId="20000000-0000-4000-8000-000000000001" />)
    const textbox = screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })
    fireEvent.change(textbox, { target: { value: '입력 중인 내용' } })
    expect(screen.queryByRole('checkbox', { name: '첨부 이미지 사용 권리를 확인했습니다' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '이미지 첨부 열기' }))
    expect(screen.getByRole('button', { name: '이미지 선택' })).toBeDisabled()
    confirmImageRights()
    expect(screen.getByRole('button', { name: '이미지 선택' })).toBeEnabled()
    expect(textbox).toHaveValue('입력 중인 내용')
  })
  it('still rejects a programmatic upload without explicit rights confirmation', async () => {
    const uploadMedia = vi.fn()
    render(<ConversationComposer onSubmit={vi.fn()} uploadMedia={uploadMedia} workspaceId="20000000-0000-4000-8000-000000000001" />)
    fireEvent.change(screen.getByLabelText('이미지 첨부'), { target: { files: [new File(['image'], 'asset.png', { type: 'image/png' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('사용 권리를 먼저 확인')
    expect(uploadMedia).not.toHaveBeenCalled()
  })
  it('reuses the same client id for an unchanged request after an uncertain rejection', async () => {
    const submit = vi.fn<(submission: ComposerSubmit) => Promise<boolean>>(async () => false)
    render(<ConversationComposer onSubmit={submit} />)
    const textbox = screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })
    const send = screen.getByRole('button', { name: '메시지 보내기' })
    fireEvent.change(textbox, { target: { value: '연결 확인' } })
    fireEvent.click(send)
    await waitFor(() => expect(send).toBeEnabled())
    fireEvent.click(send)
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
    expect(submit.mock.calls[0][0].clientMessageId).toBe(submit.mock.calls[1][0].clientMessageId)
    await waitFor(() => expect(send).toBeEnabled())
    fireEvent.change(textbox, { target: { value: '다른 요청' } })
    fireEvent.click(send)
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(3))
    expect(submit.mock.calls[2][0].clientMessageId).not.toBe(submit.mock.calls[0][0].clientMessageId)
  })

  it('preserves an oversized handed-off draft and asks to shorten it instead of silently truncating', () => {
    const { rerender } = render(<ConversationComposer onSubmit={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), { target: { value: '가'.repeat(7999) } })
    rerender(<ConversationComposer onSubmit={vi.fn()} draftRequest={{ id: 'global-1', text: '추가 요청', preserveExisting: true }} />)
    expect(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })).toHaveValue(`${'가'.repeat(7999)}\n추가 요청`)
    expect(screen.getByRole('button', { name: '메시지 보내기' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('8,000자')
  })

  it('keeps whitespace disabled and submits a trimmed message with an idempotency id', () => {
    const submit = vi.fn()
    render(<ConversationComposer onSubmit={submit} />)

    const textbox = screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })
    const submitButton = screen.getByRole('button', { name: '메시지 보내기' })
    expect(submitButton).toBeDisabled()

    fireEvent.change(textbox, { target: { value: '  다음 콘텐츠를 준비해 줘.  ' } })
    expect(submitButton).toBeEnabled()
    fireEvent.keyDown(textbox, { key: 'Enter', shiftKey: false })

    expect(submit).toHaveBeenCalledOnce()
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '다음 콘텐츠를 준비해 줘.',
        attachmentIds: [],
        clientMessageId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      }),
    )
    expect(textbox).toHaveValue('')
  })

  it('keeps Shift+Enter available for a line break', () => {
    const submit = vi.fn()
    render(<ConversationComposer onSubmit={submit} />)

    const textbox = screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })
    fireEvent.change(textbox, { target: { value: '첫 줄' } })
    fireEvent.keyDown(textbox, { key: 'Enter', shiftKey: true })

    expect(submit).not.toHaveBeenCalled()
    expect(textbox).toHaveValue('첫 줄')
  })

  it('uploads confirmed images and submits their asset ids in file order', async () => {
    const submit = vi.fn()
    const uploadMedia = vi
      .fn()
      .mockResolvedValueOnce({ data: { assetId: '30000000-0000-4000-8000-000000000001', rightsStatus: 'confirmed' } })
      .mockResolvedValueOnce({ data: { assetId: '30000000-0000-4000-8000-000000000002', rightsStatus: 'confirmed' } })
    render(<ConversationComposer onSubmit={submit} uploadMedia={uploadMedia} workspaceId="20000000-0000-4000-8000-000000000001" />)

    confirmImageRights()
    const files = [
      new File(['first'], 'first.png', { type: 'image/png' }),
      new File(['second'], 'second.png', { type: 'image/png' }),
    ]
    fireEvent.change(screen.getByLabelText('이미지 첨부'), { target: { files } })

    await waitFor(() => expect(screen.getByText('2장 첨부됨')).toBeInTheDocument())
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), {
      target: { value: '첨부 사진으로 네이버 글을 만들어줘.' },
    })
    fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))

    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      attachmentIds: [
        '30000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000002',
      ],
    }))
  })

  it('exposes current attachment ids to the interview card and clears them only after accepted submit', async () => {
    const submit = vi.fn(async () => true)
    const attachmentIds = vi.fn()
    const uploadMedia = vi.fn().mockResolvedValue({
      data: { assetId: '30000000-0000-4000-8000-000000000004', rightsStatus: 'confirmed' },
    })
    render(
      <ConversationComposer
        onAttachmentIdsChange={attachmentIds}
        onSubmit={submit}
        uploadMedia={uploadMedia}
        workspaceId="20000000-0000-4000-8000-000000000001"
      />,
    )

    confirmImageRights()
    fireEvent.change(screen.getByLabelText('이미지 첨부'), {
      target: { files: [new File(['image'], 'asset.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(attachmentIds).toHaveBeenLastCalledWith(['30000000-0000-4000-8000-000000000004']))

    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), {
      target: { value: '다음 질문 답변' },
    })
    fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))

    await waitFor(() => expect(attachmentIds).toHaveBeenLastCalledWith([]))
  })

  it('keeps attachment ids when submit is rejected', async () => {
    const attachmentIds = vi.fn()
    const uploadMedia = vi.fn().mockResolvedValue({
      data: { assetId: '30000000-0000-4000-8000-000000000005', rightsStatus: 'confirmed' },
    })
    render(
      <ConversationComposer
        onAttachmentIdsChange={attachmentIds}
        onSubmit={vi.fn(async () => false)}
        uploadMedia={uploadMedia}
        workspaceId="20000000-0000-4000-8000-000000000001"
      />,
    )

    confirmImageRights()
    fireEvent.change(screen.getByLabelText('이미지 첨부'), {
      target: { files: [new File(['image'], 'asset.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(screen.getByText('1장 첨부됨')).toBeInTheDocument())
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), {
      target: { value: '다시 시도할 질문' },
    })
    fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))

    await waitFor(() => expect(screen.getByText('1장 첨부됨')).toBeInTheDocument())
    expect(attachmentIds).not.toHaveBeenLastCalledWith([])
  })

  it('uses the authenticated Sohee media endpoint when no injected uploader is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { assetId: '30000000-0000-4000-8000-000000000003', rightsStatus: 'confirmed' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ConversationComposer onSubmit={vi.fn()} workspaceId="20000000-0000-4000-8000-000000000001" />)

    confirmImageRights()
    fireEvent.change(screen.getByLabelText('이미지 첨부'), {
      target: { files: [new File(['image'], 'asset.png', { type: 'image/png' })] },
    })

    await waitFor(() => expect(screen.getByText('1장 첨부됨')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/20000000-0000-4000-8000-000000000001/media',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
    )
    vi.unstubAllGlobals()
  })
})
