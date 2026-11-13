import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FourChannelStudio } from './four-channel-studio'
import type { ChannelDraftResult } from '../types'

const mockDraftResult: ChannelDraftResult = {
  requestKey: 'test-req-123',
  topic: '가게 첫 인사',
  createdAt: '2026-10-08T00:00:00.000Z',
  basisNotes: ['지식 v3 기준', '가격 정보가 없어서 가격·할인 문구는 넣지 않았어요'],
  imageNotice: null,
  variants: [
    {
      channel: 'instagram',
      payload: { caption: '인스타그램 인사말 #환영', hashtags: ['환영'] },
      status: 'READY',
      statusLabel: '규격 확인 완료',
      issues: [],
      contentId: 'cnt-1',
      versionId: 'ver-1',
      vaultSavable: true,
      blockedReason: null,
    },
    {
      channel: 'threads',
      payload: { text: '스레드 본문 인사글', hashtags: ['스레드'] },
      status: 'READY',
      statusLabel: '규격 확인 완료',
      issues: [],
      contentId: 'cnt-2',
      versionId: 'ver-2',
      vaultSavable: true,
      blockedReason: null,
    },
    {
      channel: 'naver_blog',
      payload: { title: '블로그 제목 첫인사', text: '네이버 블로그 본문 내용' },
      status: 'NEEDS_CHECK',
      statusLabel: '확인이 필요해요',
      issues: ['대표 이미지가 없어요'],
      contentId: 'cnt-3',
      versionId: 'ver-3',
      vaultSavable: false,
      blockedReason: '이미지가 필요해요',
    },
    {
      channel: 'daangn_business',
      payload: { text: '당근 소식 이웃 환영' },
      status: 'READY',
      statusLabel: '규격 확인 완료',
      issues: [],
      contentId: 'cnt-4',
      versionId: 'ver-4',
      vaultSavable: true,
      blockedReason: null,
    },
  ],
}

describe('FourChannelStudio', () => {
  it('shows input form with recommended topic chips', () => {
    render(<FourChannelStudio workspaceId="ws-test" />)

    const input = screen.getByLabelText('어떤 소식을 전할까요?')
    expect(input).toBeInTheDocument()

    const submitBtn = screen.getByRole('button', { name: '채널별 글 만들기' })
    expect(submitBtn).toBeInTheDocument()

    const chip = screen.getByRole('button', { name: '가게 첫 인사' })
    fireEvent.click(chip)
    expect(input).toHaveValue('가게 첫 인사')
  })

  it('사진 체크박스는 기본 해제이고 선택했을 때만 includeImage=true를 보낸다', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ draft: mockDraftResult }) })
    render(<FourChannelStudio workspaceId="ws-test" fetcher={fetcher as any} />)
    const checkbox = screen.getByRole('checkbox', { name: '사진도 함께 만들기 (조금 더 걸려요)' })
    expect(checkbox).not.toBeChecked()
    fireEvent.change(screen.getByLabelText('어떤 소식을 전할까요?'), { target: { value: '가게 첫 인사' } })
    fireEvent.click(screen.getByRole('button', { name: '채널별 글 만들기' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetcher.mock.calls[0][1].body).includeImage).toBe(false)
    await screen.findByRole('tab', { name: /인스타그램/ })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: '채널별 글 만들기' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetcher.mock.calls[1][1].body).includeImage).toBe(true)
  })

  it('renders initialDraft directly when provided', () => {
    render(<FourChannelStudio workspaceId="ws-test" initialDraft={mockDraftResult} />)

    expect(screen.getByRole('tab', { name: /인스타그램/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /스레드/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /네이버 블로그/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /당근 비즈프로필/ })).toBeInTheDocument()
    expect(screen.getByText('이 글의 기준')).toBeInTheDocument()
  })

  it('generates 4 channel previews on submission without publishing or scheduling buttons', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ draft: mockDraftResult }),
    })

    render(<FourChannelStudio workspaceId="ws-test" fetcher={fetcher as any} />)

    const input = screen.getByLabelText('어떤 소식을 전할까요?')
    fireEvent.change(input, { target: { value: '가게 첫 인사' } })
    fireEvent.click(screen.getByRole('button', { name: '채널별 글 만들기' }))

    // 4 tabs must be visible
    expect(await screen.findByRole('tab', { name: /인스타그램/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /스레드/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /네이버 블로그/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /당근 비즈프로필/ })).toBeInTheDocument()

    // Preview frame badge
    expect(screen.getByText('예상 화면')).toBeInTheDocument()

    // No publishing / scheduling buttons
    expect(screen.queryByRole('button', { name: /발행/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /예약/ })).not.toBeInTheDocument()

    // Basis notes
    expect(screen.getByText('이 글의 기준')).toBeInTheDocument()
    expect(screen.getByText('지식 v3 기준')).toBeInTheDocument()
  })

  it('빈 variant 응답은 성공이 아닌 오류로 보여 준다', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ draft: { ...mockDraftResult, variants: [] } }) })
    render(<FourChannelStudio workspaceId="ws-test" fetcher={fetcher as any} />)
    fireEvent.change(screen.getByLabelText('어떤 소식을 전할까요?'), { target: { value: '가게 인사' } })
    fireEvent.click(screen.getByRole('button', { name: '채널별 글 만들기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('생성 결과를 확인할 수 없어요')
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('prevents duplicate submissions and displays loading status', async () => {
    let resolvePromise: (value: any) => void = () => {}
    const slowPromise = new Promise((resolve) => {
      resolvePromise = resolve
    })
    const fetcher = vi.fn().mockReturnValue(slowPromise)

    render(<FourChannelStudio workspaceId="ws-test" fetcher={fetcher as any} />)

    const input = screen.getByLabelText('어떤 소식을 전할까요?')
    fireEvent.change(input, { target: { value: '신메뉴 안내' } })
    const submitBtn = screen.getByRole('button', { name: '채널별 글 만들기' })
    fireEvent.click(submitBtn)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(submitBtn).toBeDisabled()

    resolvePromise({
      ok: true,
      json: async () => ({ draft: mockDraftResult }),
    })

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })

  it('서버가 원시 제공자 오류와 영문 코드를 보내도 화면에는 고정 한국어 문구만 보여 준다', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'sk-secret (CROSS_TENANT_ACCESS_DENIED)', code: 'UNKNOWN_BACKEND' }) })
    render(<FourChannelStudio workspaceId="ws-test" fetcher={fetcher as any} />)
    fireEvent.change(screen.getByLabelText('어떤 소식을 전할까요?'), { target: { value: '가게 인사' } })
    fireEvent.click(screen.getByRole('button', { name: '채널별 글 만들기' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('채널별 글을 만들지 못했어요')
    expect(alert.textContent).not.toMatch(/sk-secret|CROSS_TENANT|UNKNOWN_BACKEND/)
  })

  it('handles server error with role=alert and reuses requestKey on retry', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: '가게 정보를 불러오지 못했어요.', code: 'KNOWLEDGE_UNAVAILABLE' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ draft: mockDraftResult }),
      })

    render(<FourChannelStudio workspaceId="ws-test" fetcher={fetcher as any} />)

    const input = screen.getByLabelText('어떤 소식을 전할까요?')
    fireEvent.change(input, { target: { value: '이벤트 소식' } })
    fireEvent.click(screen.getByRole('button', { name: '채널별 글 만들기' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('가게 정보를 불러오지 못했어요.')

    const retryBtn = screen.getByRole('button', { name: '다시 시도' })
    fireEvent.click(retryBtn)

    expect(fetcher).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(fetcher.mock.calls[0][1].body)
    const secondBody = JSON.parse(fetcher.mock.calls[1][1].body)
    expect(firstBody.requestKey).toBe(secondBody.requestKey)

    expect(await screen.findByRole('tab', { name: /인스타그램/ })).toBeInTheDocument()
  })

  it('navigates tabs using keyboard arrow keys', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ draft: mockDraftResult }),
    })

    render(<FourChannelStudio workspaceId="ws-test" fetcher={fetcher as any} />)

    const input = screen.getByLabelText('어떤 소식을 전할까요?')
    fireEvent.change(input, { target: { value: '인사' } })
    fireEvent.click(screen.getByRole('button', { name: '채널별 글 만들기' }))

    const instaTab = await screen.findByRole('tab', { name: /인스타그램/ })
    const threadsTab = screen.getByRole('tab', { name: /스레드/ })

    fireEvent.keyDown(instaTab, { key: 'ArrowRight' })
    expect(threadsTab).toHaveFocus()
    expect(threadsTab).toHaveAttribute('aria-selected', 'true')
  })

  it('disables save button with blockedReason when vaultSavable is false', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ draft: mockDraftResult }),
    })

    render(<FourChannelStudio workspaceId="ws-test" fetcher={fetcher as any} />)

    const input = screen.getByLabelText('어떤 소식을 전할까요?')
    fireEvent.change(input, { target: { value: '인사' } })
    fireEvent.click(screen.getByRole('button', { name: '채널별 글 만들기' }))

    const naverTab = await screen.findByRole('tab', { name: /네이버 블로그/ })
    fireEvent.click(naverTab)

    expect(screen.getAllByText('확인이 필요해요').length).toBeGreaterThan(0)
    expect(screen.getByText('대표 이미지가 없어요')).toBeInTheDocument()

    const saveBtn = screen.getByRole('button', { name: '이 채널 글 보관하기' })
    expect(saveBtn).toBeDisabled()
    expect(screen.getByText('이미지가 필요해요')).toBeInTheDocument()
  })

  it('saves draft channel to vault and shows vault link', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ draft: mockDraftResult }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          saved: [{ channel: 'instagram', status_label: '보관됨', release_gate_label: '대기' }],
          rejected: [],
          external_posts: 0,
        }),
      })

    render(<FourChannelStudio workspaceId="ws-test" fetcher={fetcher as any} />)

    const input = screen.getByLabelText('어떤 소식을 전할까요?')
    fireEvent.change(input, { target: { value: '인사' } })
    fireEvent.click(screen.getByRole('button', { name: '채널별 글 만들기' }))

    const saveBtn = await screen.findByRole('button', { name: '이 채널 글 보관하기' })
    fireEvent.click(saveBtn)

    expect(await screen.findByText('보관했어요 · 외부 게시 전')).toBeInTheDocument()
    const vaultLink = screen.getByRole('link', { name: '보관함에서 확인하기' })
    expect(vaultLink).toHaveAttribute('href', '/app/vault')
  })

  it('rejects save if external_posts is not 0 (no false green)', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ draft: mockDraftResult }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          saved: [{ channel: 'instagram', status_label: '보관됨', release_gate_label: '대기' }],
          rejected: [],
          external_posts: 1, // Unexpected external post!
        }),
      })

    render(<FourChannelStudio workspaceId="ws-test" fetcher={fetcher as any} />)

    const input = screen.getByLabelText('어떤 소식을 전할까요?')
    fireEvent.change(input, { target: { value: '인사' } })
    fireEvent.click(screen.getByRole('button', { name: '채널별 글 만들기' }))

    const saveBtn = await screen.findByRole('button', { name: '이 채널 글 보관하기' })
    fireEvent.click(saveBtn)

    expect(screen.queryByText('보관했어요 · 외부 게시 전')).not.toBeInTheDocument()
    expect(await screen.findByText(/보관 결과를 확인할 수 없어요/)).toBeInTheDocument()
  })

  describe('복사 기능', () => {
    it('글 복사하기 버튼 클릭 시 클립보드에 채널 텍스트를 복사하고 복사했어요 안내를 띄운다', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, {
        clipboard: { writeText },
      })

      render(<FourChannelStudio workspaceId="ws-test" initialDraft={mockDraftResult} />)

      const copyBtn = screen.getByRole('button', { name: '글 복사하기' })
      fireEvent.click(copyBtn)

      expect(writeText).toHaveBeenCalledWith('인스타그램 인사말 #환영\n\n#환영')
      const status = await screen.findByRole('status')
      expect(status).toHaveTextContent('복사했어요')
    })

    it('클립보드 API 실패 시 직접 선택 복사용 textarea를 제공한다', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('Permission denied'))
      Object.assign(navigator, {
        clipboard: { writeText },
      })

      render(<FourChannelStudio workspaceId="ws-test" initialDraft={mockDraftResult} />)

      const copyBtn = screen.getByRole('button', { name: '글 복사하기' })
      fireEvent.click(copyBtn)

      const fallbackTextarea = await screen.findByLabelText('직접 선택해서 복사해 주세요')
      expect(fallbackTextarea).toBeInTheDocument()
      expect(fallbackTextarea).toHaveValue('인스타그램 인사말 #환영\n\n#환영')
      expect(fallbackTextarea).toHaveAttribute('readonly')
    })
  })

  describe('다시 만들기 기능', () => {
    it('같은 주제로 다시 만들기는 새 requestKey로 호출하고 기존 결과를 유지한다', async () => {
      let resolvePromise: (value: any) => void = () => {}
      const slowPromise = new Promise((resolve) => {
        resolvePromise = resolve
      })
      const fetcher = vi.fn().mockReturnValue(slowPromise)

      render(<FourChannelStudio workspaceId="ws-test" initialDraft={mockDraftResult} fetcher={fetcher as any} />)

      const regenBtn = screen.getByRole('button', { name: '같은 주제로 다시 만들기' })
      fireEvent.click(regenBtn)

      // 진행 중 중복 제출 방지 (disabled)
      expect(regenBtn).toBeDisabled()
      // 기존 결과는 새 결과가 오기 전까지 유지
      expect(screen.getByRole('tab', { name: /인스타그램/ })).toBeInTheDocument()

      expect(fetcher).toHaveBeenCalledTimes(1)
      const call = fetcher.mock.calls[0]
      expect(call[0]).toBe('/api/workspaces/ws-test/channel-drafts')
      const body = JSON.parse(call[1].body)
      expect(body.topic).toBe('가게 첫 인사')
      expect(body.requestKey).not.toBe(mockDraftResult.requestKey)

      const updatedDraft: ChannelDraftResult = {
        ...mockDraftResult,
        requestKey: body.requestKey,
        topic: '가게 첫 인사',
        variants: mockDraftResult.variants.map((v) => ({
          ...v,
          payload: { ...v.payload, caption: '새롭게 다시 만든 인사' },
        })),
      }

      resolvePromise({
        ok: true,
        json: async () => ({ draft: updatedDraft }),
      })

      await waitFor(() => {
        expect(regenBtn).not.toBeDisabled()
      })
    })
  })

  describe('직접 고치기 기능', () => {
    it('직접 고치기 토글 시 편집 영역이 열리고 바뀐 필드만 PATCH 요청으로 전송한다', async () => {
      const fetcher = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          draft: {
            ...mockDraftResult,
            variants: mockDraftResult.variants.map((v) =>
              v.channel === 'instagram'
                ? { ...v, payload: { caption: '수정된 캡션', hashtags: ['환영'] }, status: 'READY', statusLabel: '규격 확인 완료' }
                : v,
            ),
          },
        }),
      })

      render(<FourChannelStudio workspaceId="ws-test" initialDraft={mockDraftResult} fetcher={fetcher as any} />)

      const editToggle = screen.getByRole('button', { name: '직접 고치기' })
      fireEvent.click(editToggle)

      // 편집 폼 필드 노출 확인
      const captionTextarea = screen.getByLabelText('캡션')
      expect(captionTextarea).toBeInTheDocument()

      // 캡션만 수정
      fireEvent.change(captionTextarea, { target: { value: '수정된 캡션' } })

      // 저장하지 않은 수정 안내
      expect(screen.getByText('저장하지 않은 수정이 있어요')).toBeInTheDocument()

      // 편집 중에는 보관 버튼 비활성화 (No False Green)
      const saveBtn = screen.getByRole('button', { name: '이 채널 글 보관하기' })
      expect(saveBtn).toBeDisabled()

      // 저장하고 다시 확인 클릭
      const saveEditBtn = screen.getByRole('button', { name: '저장하고 다시 확인' })
      fireEvent.click(saveEditBtn)

      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
      const call = fetcher.mock.calls[0]
      expect(call[0]).toBe('/api/workspaces/ws-test/channel-drafts')
      expect(call[1].method).toBe('PATCH')
      const body = JSON.parse(call[1].body)
      expect(body.requestKey).toBe(mockDraftResult.requestKey)
      expect(body.channel).toBe('instagram')
      // 바뀐 필드만 전달 (caption만 있고 hashtags는 없음)
      expect(body.edits).toEqual({ caption: '수정된 캡션' })
    })

    it('네이버 블로그에서 제목만 수정 시 edits에 title만 담긴다', async () => {
      const fetcher = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          draft: mockDraftResult,
        }),
      })

      render(<FourChannelStudio workspaceId="ws-test" initialDraft={mockDraftResult} fetcher={fetcher as any} />)

      // 네이버 블로그 탭 클릭
      fireEvent.click(screen.getByRole('tab', { name: /네이버 블로그/ }))

      const editToggle = screen.getByRole('button', { name: '직접 고치기' })
      fireEvent.click(editToggle)

      const titleInput = screen.getByLabelText('제목')
      fireEvent.change(titleInput, { target: { value: '고친 블로그 제목' } })

      const saveEditBtn = screen.getByRole('button', { name: '저장하고 다시 확인' })
      fireEvent.click(saveEditBtn)

      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
      const body = JSON.parse(fetcher.mock.calls[0][1].body)
      expect(body.channel).toBe('naver_blog')
      expect(body.edits).toEqual({ title: '고친 블로그 제목' })
    })

    it('PATCH 오류 시 알려진 코드만 한국어 문구로 매핑하고 영문 코드는 숨긴다', async () => {
      const fetcher = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: 'raw schema mismatch (VALIDATION_FAILED)',
          code: 'VALIDATION_FAILED',
        }),
      })

      render(<FourChannelStudio workspaceId="ws-test" initialDraft={mockDraftResult} fetcher={fetcher as any} />)

      fireEvent.click(screen.getByRole('button', { name: '직접 고치기' }))
      const captionTextarea = screen.getByLabelText('캡션')
      fireEvent.change(captionTextarea, { target: { value: '수정 테스트' } })

      fireEvent.click(screen.getByRole('button', { name: '저장하고 다시 확인' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('주제와 요청 정보를 확인해 주세요.')
      expect(alert.textContent).not.toMatch(/VALIDATION_FAILED|raw schema mismatch/)
    })
  })

  it('INSUFFICIENT_CREDITS 에러 시 크레딧 충전 유도 대신 한도 문구를 표시한다', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: 'insufficient credits',
        code: 'INSUFFICIENT_CREDITS',
      }),
    })

    render(<FourChannelStudio workspaceId="ws-test" fetcher={fetcher as any} />)

    const input = screen.getByLabelText('어떤 소식을 전할까요?')
    fireEvent.change(input, { target: { value: '한도 테스트' } })
    fireEvent.click(screen.getByRole('button', { name: '채널별 글 만들기' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('이번 주기의 이용 한도를 모두 사용했어요. 다음 갱신 주기에 다시 이용할 수 있어요. 더 많은 작업이 필요하면 플랜 변경을 문의해 주세요.')
    expect(alert.textContent).not.toMatch(/크레딧|충전/)
  })
})
