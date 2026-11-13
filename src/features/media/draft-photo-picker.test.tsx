import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DraftPhotoPicker } from './draft-photo-picker'
import type { DraftPhotoPickerProps } from './draft-photo-picker.types'

const defaultProps: DraftPhotoPickerProps = {
  workspaceId: 'w1',
  items: [],
  selectedId: null,
  phase: null,
  isUploading: false,
  error: null,
  notice: null,
  file: null,
  copyright: false,
  people: 'unknown',
  consent: '',
  confirmWithdrawalId: null,
  onPickFile: vi.fn(),
  onCopyrightChange: vi.fn(),
  onPeopleChange: vi.fn(),
  onConsentChange: vi.fn(),
  onUpload: vi.fn(),
  onCancelTransfer: vi.fn(),
  onReload: vi.fn(),
  onSelect: vi.fn(),
  onAskWithdraw: vi.fn(),
  onWithdraw: vi.fn(),
}

describe('DraftPhotoPicker', () => {
  it('renders top bar with photo title and reload button', () => {
    const onReload = vi.fn()
    render(<DraftPhotoPicker {...defaultProps} onReload={onReload} />)

    expect(screen.getByText('사진')).toBeInTheDocument()
    const reloadButton = screen.getByRole('button', { name: '저장한 사진 다시 확인' })
    fireEvent.click(reloadButton)
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('renders photo grid tiles with select, selected, and ineligible states', () => {
    const onSelect = vi.fn()
    const items = [
      { id: 'p1', eligible: true, src: 'https://example.com/1.jpg' },
      { id: 'p2', eligible: true, src: 'https://example.com/2.jpg' },
      { id: 'p3', eligible: false, src: 'https://example.com/3.jpg' },
    ]
    render(
      <DraftPhotoPicker
        {...defaultProps}
        items={items}
        selectedId="p1"
        onSelect={onSelect}
      />,
    )

    const buttons = screen.getAllByRole('button', { name: '이 사진 선택' })
    expect(buttons).toHaveLength(2)

    // p1 is selected
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true')
    // p2 is not selected
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(buttons[1])
    expect(onSelect).toHaveBeenCalledWith('p2')

    // p3 is ineligible
    const lockedButton = screen.getByRole('button', { name: '권리 확인 필요' })
    expect(lockedButton).toBeDisabled()
  })

  it('renders add photo tile with file input and calls onPickFile on change', () => {
    const onPickFile = vi.fn()
    render(<DraftPhotoPicker {...defaultProps} onPickFile={onPickFile} />)

    const input = screen.getByLabelText('가게 사진 고르기') as HTMLInputElement
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('id', 'owner-photo')
    expect(input.accept).toContain('image/jpeg')

    const file = new File(['dummy'], 'test.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onPickFile).toHaveBeenCalledWith(file)
    expect(input.value).toBe('')
  })

  it('handles withdrawal ask and confirmation bar', () => {
    const onAskWithdraw = vi.fn()
    const onWithdraw = vi.fn()
    const items = [{ id: 'p1', eligible: true, src: 'https://example.com/1.jpg' }]

    const { rerender } = render(
      <DraftPhotoPicker
        {...defaultProps}
        items={items}
        onAskWithdraw={onAskWithdraw}
        onWithdraw={onWithdraw}
      />,
    )

    const banButton = screen.getByRole('button', { name: '사진 공개 사용 중단' })
    fireEvent.click(banButton)
    expect(onAskWithdraw).toHaveBeenCalledWith('p1')

    // When confirmWithdrawalId matches p1
    rerender(
      <DraftPhotoPicker
        {...defaultProps}
        items={items}
        confirmWithdrawalId="p1"
        onAskWithdraw={onAskWithdraw}
        onWithdraw={onWithdraw}
      />,
    )

    expect(screen.getByText('이 사진 사용을 중단할까요?')).toBeInTheDocument()
    const confirmButton = screen.getByRole('button', { name: '이 사진 사용 중단 확인' })
    fireEvent.click(confirmButton)
    expect(onWithdraw).toHaveBeenCalledWith('p1')

    const cancelButton = screen.getByRole('button', { name: '취소' })
    fireEvent.click(cancelButton)
    expect(onAskWithdraw).toHaveBeenCalledWith(null)
  })

  it('renders file card with copyright toggle, people segment, consent input, and upload button', () => {
    const onCopyrightChange = vi.fn()
    const onPeopleChange = vi.fn()
    const onConsentChange = vi.fn()
    const onUpload = vi.fn()
    const file = new File(['dummy content'], 'cafe.jpg', { type: 'image/jpeg' })

    const { rerender } = render(
      <DraftPhotoPicker
        {...defaultProps}
        file={file}
        copyright={false}
        people="unknown"
        onCopyrightChange={onCopyrightChange}
        onPeopleChange={onPeopleChange}
        onConsentChange={onConsentChange}
        onUpload={onUpload}
      />,
    )

    expect(screen.getByText('cafe.jpg')).toBeInTheDocument()

    // Copyright toggle
    const copyrightCheckbox = screen.getByRole('checkbox', { name: /내 사진이에요/ })
    expect(copyrightCheckbox).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(copyrightCheckbox)
    expect(onCopyrightChange).toHaveBeenCalledWith(true)

    // People segment
    const radioNone = screen.getByRole('radio', { name: '알아볼 수 있는 사람이 없어요' })
    const radioUnknown = screen.getByRole('radio', { name: '아직 확인하지 않았어요' })
    const radioConsented = screen.getByRole('radio', { name: '등장한 모든 사람의 홍보 사용 동의를 받았어요' })

    expect(radioUnknown).toHaveAttribute('aria-checked', 'true')
    expect(radioNone).toHaveAttribute('aria-checked', 'false')
    expect(radioConsented).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(radioConsented)
    expect(onPeopleChange).toHaveBeenCalledWith('consented')

    // consent input is not rendered when people is unknown
    expect(screen.queryByLabelText('동의 근거 관리번호')).not.toBeInTheDocument()

    // Rerender with consented
    rerender(
      <DraftPhotoPicker
        {...defaultProps}
        file={file}
        people="consented"
        consent=""
        onConsentChange={onConsentChange}
        onUpload={onUpload}
      />,
    )

    const consentInput = screen.getByLabelText('동의 근거 관리번호')
    fireEvent.change(consentInput, { target: { value: 'DOC-123' } })
    expect(onConsentChange).toHaveBeenCalledWith('DOC-123')

    // Upload button
    const uploadButton = screen.getByRole('button', { name: '사진 저장하기' })
    fireEvent.click(uploadButton)
    expect(onUpload).toHaveBeenCalledTimes(1)
  })

  it('renders retry upload button when error exists', () => {
    const file = new File(['dummy'], 'cafe.jpg', { type: 'image/jpeg' })
    render(
      <DraftPhotoPicker
        {...defaultProps}
        file={file}
        error="저장에 실패했습니다."
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('저장에 실패했습니다.')
    expect(screen.getByRole('button', { name: '사진 저장 다시 시도' })).toBeInTheDocument()
  })

  it('disables controls and displays phase and cancel buttons during operation', () => {
    const onCancelTransfer = vi.fn()
    const file = new File(['dummy'], 'cafe.jpg', { type: 'image/jpeg' })

    const { rerender } = render(
      <DraftPhotoPicker
        {...defaultProps}
        file={file}
        phase="사진 전송 중…"
        isUploading={true}
        onCancelTransfer={onCancelTransfer}
      />,
    )

    expect(screen.getByText('사진 전송 중…')).toBeInTheDocument()
    const cancelButton = screen.getByRole('button', { name: '전송 중단' })
    fireEvent.click(cancelButton)
    expect(onCancelTransfer).toHaveBeenCalledTimes(1)

    // HEIC phase test
    rerender(
      <DraftPhotoPicker
        {...defaultProps}
        file={file}
        phase="HEIC 사진 변환 중…"
        isUploading={false}
        onCancelTransfer={onCancelTransfer}
      />,
    )

    const heicCancelButton = screen.getByRole('button', { name: '변환 취소' })
    fireEvent.click(heicCancelButton)
    expect(onCancelTransfer).toHaveBeenCalledTimes(2)
  })

  it('renders notice with role="status"', () => {
    render(<DraftPhotoPicker {...defaultProps} notice="사진이 성공적으로 저장되었습니다." />)
    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent('사진이 성공적으로 저장되었습니다.')
  })

  it('disables file input and reload button when phase is active', () => {
    render(<DraftPhotoPicker {...defaultProps} phase="처리 중…" />)
    expect(screen.getByLabelText('가게 사진 고르기')).toBeDisabled()
    expect(screen.getByRole('button', { name: '저장한 사진 다시 확인' })).toBeDisabled()
  })

  it('renders auxiliary helper note when file is present', () => {
    const file = new File(['dummy'], 'test.png', { type: 'image/png' })
    render(<DraftPhotoPicker {...defaultProps} file={file} />)
    expect(screen.getByText('공개 게시엔 권리 확인이 필요해요')).toBeInTheDocument()
  })
})
