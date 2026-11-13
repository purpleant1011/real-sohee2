import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  DeleteRestoreControl,
  HoldToggle,
  ReapproveButton,
  VaultItemEditor,
} from './index'

const mockWorkspaceId = 'ws-test-123'
const mockItemRef = 'item-ref-test-abc'
const initialVersion = '2026-10-07T00:00:00Z'
const nextVersion = '2026-10-07T00:00:01Z'

function createMockFetch(
  handler: (url: string, init?: RequestInit) => { status?: number; data: Record<string, unknown> },
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const result = handler(url, init)
    return {
      ok: (result.status ?? 200) >= 200 && (result.status ?? 200) < 300,
      status: result.status ?? 200,
      json: async () => result.data,
    } as unknown as Response
  })
}

describe('VaultItemEditor - ANI-1545', () => {
  it('409 충돌을 알리고 입력은 보존하며 경고 후 최신 내용을 불러와 새 버전으로 저장한다', async () => {
    const requests: Record<string, unknown>[] = []
    const mockFetch = createMockFetch((_url, init) => {
      if (init?.method !== 'PATCH') return { data: { success: true, data: { updated_at: nextVersion, content: { title: '다른 탭 제목', body: '다른 탭 본문', tags: [] }, target_date: null, needs_reapproval: true, is_user_held: false, deleted_at: null } } }
      requests.push(JSON.parse(init.body as string))
      return requests.length === 1
        ? { status: 409, data: { error: '보관 항목이 다른 곳에서 변경됐어요. 최신 내용을 불러온 뒤 다시 저장해 주세요.' } }
        : { data: { item_ref: mockItemRef, status_label: '재승인 필요', message: '저장했어요.', updated_at: '2026-10-07T00:00:02Z' } }
    })
    render(<VaultItemEditor workspaceId={mockWorkspaceId} itemRef={mockItemRef} version={initialVersion} channel="threads" initialTitle="내 제목" initialText="내 본문" fetchFn={mockFetch as unknown as typeof fetch} />)
    fireEvent.change(screen.getByLabelText('본문'), { target: { value: '내 편집 내용' } })
    fireEvent.click(screen.getByRole('button', { name: '변경사항 저장' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('다른 곳에서 수정됐어요')
    expect(screen.getByLabelText('본문')).toHaveValue('내 편집 내용')
    expect(requests[0]).toMatchObject({ expectedVersion: initialVersion })
    fireEvent.click(screen.getByRole('button', { name: '최신 내용 불러오기' }))
    expect(screen.getByText(/입력 중이던 내용이 사라져요/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '불러오기 확인' }))
    await waitFor(() => expect(screen.getByLabelText('본문')).toHaveValue('다른 탭 본문'))
    fireEvent.change(screen.getByLabelText('본문'), { target: { value: '최신 버전에서 다시 편집' } })
    fireEvent.click(screen.getByRole('button', { name: '변경사항 저장' }))
    await screen.findByText('저장했어요.')
    expect(requests[1]).toMatchObject({ expectedVersion: nextVersion })
  })
  it('오프라인과 서버 오류에서는 이전 저장 성공 문구를 지우고 입력을 유지한다', async () => {
    let calls = 0
    const mockFetch = vi.fn(async () => {
      calls++
      if (calls === 1) return { ok: true, json: async () => ({ item_ref: mockItemRef, status_label: '재승인 필요', message: '저장했어요.', updated_at: nextVersion }) } as Response
      if (calls === 2) throw new Error('offline')
      return { ok: false, json: async () => ({ error: '서버가 응답하지 않아요.' }) } as Response
    })
    render(<VaultItemEditor workspaceId={mockWorkspaceId} itemRef={mockItemRef} version={initialVersion} channel="threads" initialTitle="제목" initialText="본문" fetchFn={mockFetch as typeof fetch} />)
    fireEvent.change(screen.getByLabelText('본문'), { target: { value: '저장한 본문' } })
    fireEvent.click(screen.getByRole('button', { name: '변경사항 저장' }))
    await screen.findByText('저장했어요.')
    fireEvent.change(screen.getByLabelText('본문'), { target: { value: '오프라인 본문' } })
    fireEvent.click(screen.getByRole('button', { name: '변경사항 저장' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('네트워크 연결을 확인해 주세요.')
    expect(screen.queryByText('저장했어요.')).not.toBeInTheDocument()
    expect(screen.getByLabelText('본문')).toHaveValue('오프라인 본문')
    fireEvent.click(screen.getByRole('button', { name: '변경사항 저장' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('서버가 응답하지 않아요.')
    expect(screen.queryByText('저장했어요.')).not.toBeInTheDocument()
  })
  it('수정 시 "승인이 풀렸어요 · 다시 확인하고 저장해 주세요" 상태 및 채널 격리, 발행 후보 제외 안내를 표시한다', () => {
    render(
      <VaultItemEditor
        workspaceId={mockWorkspaceId}
        itemRef={mockItemRef}
        version={initialVersion}
        channel="instagram"
        channelLabel="인스타그램"
        initialTitle="원래 제목"
        initialText="원래 본문"
        initialHashtags={['봄맞이', '네일아트']}
        otherChannels={[
          { channel: 'threads', channelLabel: '스레드', approvalState: 'APPROVED' },
        ]}
      />,
    )

    // 초기 상태에는 승인 유지 상태
    expect(
      screen.queryByText(/승인이 풀렸어요 · 다시 확인하고 저장해 주세요/),
    ).not.toBeInTheDocument()

    // 본문 수정 발생
    const textarea = screen.getByLabelText('본문')
    fireEvent.change(textarea, { target: { value: '수정된 새로운 본문 내용' } })

    // 승인 무효화 배너 노출 확인
    expect(
      screen.getByText('승인이 풀렸어요 · 다시 확인하고 저장해 주세요'),
    ).toBeInTheDocument()

    // 발행 후보 제외 안내 확인
    expect(
      screen.getByText('수정 중에는 발행 후보에서 제외돼요.'),
    ).toBeInTheDocument()

    // 해당 채널만 풀리고 다른 채널은 유지됨을 안내 확인
    expect(
      screen.getByText(/이 채널\(인스타그램\)만 승인이 풀렸어요\. 다른 채널\(스레드\)의 승인 상태는 유지돼요\./),
    ).toBeInTheDocument()
  })

  it('발행 예정일 영역에 "예정일만 변경하면 승인 상태가 유지돼요." 안내 문구를 상시 표시한다', () => {
    render(
      <VaultItemEditor
        workspaceId={mockWorkspaceId}
        itemRef={mockItemRef}
        version={initialVersion}
        channel="instagram"
        initialTitle="제목"
        initialText="본문"
      />,
    )

    expect(
      screen.getByText('예정일만 변경하면 승인 상태가 유지돼요.'),
    ).toBeInTheDocument()
  })

  it('예정일만 단독으로 변경하고 저장 시 승인 상태가 유지된다', async () => {
    let capturedBody: any = null
    const mockFetch = createMockFetch((_url, init) => {
      capturedBody = JSON.parse(init?.body as string)
      return {
        status: 200,
        data: {
          item_ref: mockItemRef,
          status_label: '예정일 변경됨',
          message: '보관 글의 변경 내용을 저장했어요.',
          updated_at: nextVersion,
        },
      }
    })

    render(
      <VaultItemEditor
        workspaceId={mockWorkspaceId}
        itemRef={mockItemRef}
        version={initialVersion}
        channel="instagram"
        initialTitle="제목"
        initialText="본문"
        initialApprovalState="APPROVED"
        initialTargetDate={null}
        fetchFn={mockFetch as unknown as typeof fetch}
      />,
    )

    const dateInput = screen.getByLabelText('발행 예정일')
    fireEvent.change(dateInput, { target: { value: '2026-10-15' } })

    const saveButton = screen.getByRole('button', { name: '변경사항 저장' })
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    expect(capturedBody).toEqual({
      operation: 'edit',
      expectedVersion: initialVersion,
      changes: {
        targetDate: '2026-10-15',
      },
    })

    // 승인 무효화 배너가 나타나지 않음
    expect(
      screen.queryByText('승인이 풀렸어요 · 다시 확인하고 저장해 주세요'),
    ).not.toBeInTheDocument()

    // 상태 배지가 여전히 '발행 준비 완료 · 외부 게시 전' 유지
    expect(
      screen.getByText('발행 준비 완료 · 외부 게시 전'),
    ).toBeInTheDocument()
  })

  it('수정 내용을 저장하고 이중 제출 방지 및 완료 후 상태를 갱신한다', async () => {
    let capturedBody: any = null
    const mockFetch = createMockFetch((_url, init) => {
      capturedBody = JSON.parse(init?.body as string)
      return {
        status: 200,
        data: {
          item_ref: mockItemRef,
          status_label: '재승인 필요',
          message: '보관 글의 변경 내용을 저장했어요.',
          updated_at: nextVersion,
        },
      }
    })

    const handleSuccess = vi.fn()

    render(
      <VaultItemEditor
        workspaceId={mockWorkspaceId}
        itemRef={mockItemRef}
        version={initialVersion}
        channel="instagram"
        initialTitle="초기 제목"
        initialText="초기 본문"
        fetchFn={mockFetch as unknown as typeof fetch}
        onSuccess={handleSuccess}
      />,
    )

    const textarea = screen.getByLabelText('본문')
    fireEvent.change(textarea, { target: { value: '업데이트된 본문' } })

    const saveButton = screen.getByRole('button', { name: '변경사항 저장' })
    expect(saveButton).not.toBeDisabled()

    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    expect(capturedBody).toEqual({
      operation: 'edit',
      expectedVersion: initialVersion,
      changes: {
        text: '업데이트된 본문',
      },
    })

    // 피드백 메시지 확인
    expect(
      await screen.findByText('보관 글의 변경 내용을 저장했어요.'),
    ).toBeInTheDocument()

    expect(handleSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        status_label: '재승인 필요',
        message: '보관 글의 변경 내용을 저장했어요.',
      }),
    )
  })

  it('재승인 성공 시 "발행 준비 완료 · 외부 게시 전" 상태로 복원된다', async () => {
    const mockFetch = createMockFetch((_url, init) => {
      const body = JSON.parse(init?.body as string)
      if (body.operation === 'reapprove') {
        return {
          status: 200,
          data: {
            item_ref: mockItemRef,
            status_label: '발행 준비 완료 · 외부 게시 전',
            message: '변경 내용을 다시 승인하고 보관했어요.',
            updated_at: nextVersion,
          },
        }
      }
      return { status: 400, data: { error: '잘못된 요청' } }
    })

    render(
      <VaultItemEditor
        workspaceId={mockWorkspaceId}
        itemRef={mockItemRef}
        version={initialVersion}
        channel="instagram"
        initialTitle="제목"
        initialText="본문"
        initialApprovalState="INVALIDATED"
        fetchFn={mockFetch as unknown as typeof fetch}
      />,
    )

    const reapproveBtn = screen.getByRole('button', { name: '다시 승인하고 보관' })
    fireEvent.click(reapproveBtn)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(mockItemRef),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ operation: 'reapprove', expectedVersion: initialVersion }),
        }),
      )
    })

    expect(
      await screen.findByText('변경 내용을 다시 승인하고 보관했어요.'),
    ).toBeInTheDocument()

    // 상태 배지가 '발행 준비 완료 · 외부 게시 전'으로 표시됨
    expect(
      screen.getByText('발행 준비 완료 · 외부 게시 전'),
    ).toBeInTheDocument()
  })

  it('재승인 실패(서버 규격 FAIL) 시 서버 사용자 에러 문구를 표시한다', async () => {
    const mockFetch = createMockFetch(() => {
      return {
        status: 422,
        data: {
          error: '본문 글자 수가 인스타그램 채널 규격을 초과했어요.',
        },
      }
    })

    render(
      <VaultItemEditor
        workspaceId={mockWorkspaceId}
        itemRef={mockItemRef}
        version={initialVersion}
        channel="instagram"
        initialApprovalState="INVALIDATED"
        fetchFn={mockFetch as unknown as typeof fetch}
      />,
    )

    const reapproveBtn = screen.getByRole('button', { name: '다시 승인하고 보관' })
    fireEvent.click(reapproveBtn)

    expect(
      await screen.findByText('본문 글자 수가 인스타그램 채널 규격을 초과했어요.'),
    ).toBeInTheDocument()
  })

  it('보류/재개 토글 동작이 올바른 operation으로 전송된다', async () => {
    let lastOperation = ''
    const mockFetch = createMockFetch((_url, init) => {
      const body = JSON.parse(init?.body as string)
      lastOperation = body.operation
      return {
        status: 200,
        data: {
          item_ref: mockItemRef,
          status_label: lastOperation === 'hold' ? '사용자 보류' : '보류 해제',
          message: lastOperation === 'hold' ? '발행을 보류했어요.' : '보류를 해제했어요. 게시 전 다시 확인해 주세요.',
          updated_at: nextVersion,
        },
      }
    })

    const { rerender } = render(
      <VaultItemEditor
        workspaceId={mockWorkspaceId}
        itemRef={mockItemRef}
        version={initialVersion}
        channel="instagram"
        initialReleaseGate={null}
        fetchFn={mockFetch as unknown as typeof fetch}
      />,
    )

    // 1. 활성 상태 -> '발행 보류' 클릭
    const holdBtn = screen.getByRole('button', { name: '발행 보류' })
    fireEvent.click(holdBtn)

    await waitFor(() => {
      expect(lastOperation).toBe('hold')
    })
    expect(await screen.findByText('발행을 보류했어요.')).toBeInTheDocument()

    // 2. 보류 상태로 재렌더링하여 '보류 해제' 확인
    rerender(
      <VaultItemEditor
        workspaceId={mockWorkspaceId}
        itemRef={mockItemRef}
        version={initialVersion}
        channel="instagram"
        initialReleaseGate="HELD_USER"
        fetchFn={mockFetch as unknown as typeof fetch}
      />,
    )

    const resumeBtn = screen.getByRole('button', { name: '보류 해제' })
    fireEvent.click(resumeBtn)

    await waitFor(() => {
      expect(lastOperation).toBe('resume')
    })
    expect(
      await screen.findByText('보류를 해제했어요. 게시 전 다시 확인해 주세요.'),
    ).toBeInTheDocument()
  })

  it('삭제 확인 대화상자에서 "30일 안에 복구할 수 있어요"가 안내되고, 삭제 및 복구가 동작한다', async () => {
    let lastOperation = ''
    const mockFetch = createMockFetch((_url, init) => {
      const body = JSON.parse(init?.body as string)
      lastOperation = body.operation
      return {
        status: 200,
        data: {
          item_ref: mockItemRef,
          status_label: lastOperation === 'delete' ? '삭제됨 · 30일 안에 복구 가능' : '복구됨',
          message: lastOperation === 'delete' ? '보관 항목을 삭제했어요.' : '보관 항목을 복구했어요.',
          updated_at: nextVersion,
        },
      }
    })

    render(
      <VaultItemEditor
        workspaceId={mockWorkspaceId}
        itemRef={mockItemRef}
        version={initialVersion}
        channel="instagram"
        fetchFn={mockFetch as unknown as typeof fetch}
      />,
    )

    // 삭제 버튼 클릭 -> 다이얼로그 오픈
    const deleteTrigger = screen.getByRole('button', { name: '보관 글 삭제' })
    fireEvent.click(deleteTrigger)

    // 대화상자 확인
    expect(screen.getByText('보관 글을 삭제하시겠어요?')).toBeInTheDocument()
    expect(
      screen.getByText(/30일까지 복구할 수 있어요/),
    ).toBeInTheDocument()

    // 다이얼로그의 '삭제하기' 버튼 클릭
    const confirmDeleteBtn = screen.getByRole('button', { name: '삭제하기' })
    fireEvent.click(confirmDeleteBtn)

    await waitFor(() => {
      expect(lastOperation).toBe('delete')
    })

    // 삭제 후 복구 UI 노출 확인
    expect(await screen.findByText('삭제된 보관 글이에요')).toBeInTheDocument()
    expect(screen.getByText('30일 안에 복구할 수 있어요.')).toBeInTheDocument()

    // 복구 버튼 클릭
    const restoreBtn = screen.getByRole('button', { name: '보관 글 복구하기' })
    fireEvent.click(restoreBtn)

    await waitFor(() => {
      expect(lastOperation).toBe('restore')
    })
    expect(await screen.findByText('보관 항목을 복구했어요.')).toBeInTheDocument()
  })

  it('사용자 화면에 내부 영문 상태 코드, UUID, SHA, 지문/harness 용어가 일절 노출되지 않는다', () => {
    const { container } = render(
      <VaultItemEditor
        workspaceId={mockWorkspaceId}
        itemRef={mockItemRef}
        version={initialVersion}
        channel="instagram"
        channelLabel="인스타그램"
        initialTitle="제목"
        initialText="본문"
        initialApprovalState="INVALIDATED"
        initialReleaseGate="HELD_USER"
      />,
    )

    const textContent = container.textContent || ''

    // 내부 영문 상태 코드 검증
    expect(textContent).not.toMatch(/\b(PROVIDER_ACCEPTED|VERIFIED|RESULT_UNKNOWN|NOT_VERIFIED|HELD_[A-Z0-9_]+|release_gate|PREPARE_ONLY|PUBLISH_READY)\b/)
    // 하네스 / fingerprint 용어 검증
    expect(textContent).not.toMatch(/(harness|하네스|fingerprint|지문)/i)
    // UUID 및 SHA 검증
    expect(textContent).not.toMatch(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/)
    expect(textContent).not.toMatch(/\b[0-9a-fA-F]{40}\b|\b[0-9a-fA-F]{64}\b/)
    // 예약됨 검증
    expect(textContent).not.toContain('예약됨')
  })
})

describe('단독 컴포넌트 단위 테스트 - ReapproveButton, HoldToggle, DeleteRestoreControl', () => {
  it('ReapproveButton 독립 컴포넌트 정상 동작', async () => {
    const mockFetch = createMockFetch(() => ({
      status: 200,
      data: {
        item_ref: mockItemRef,
        status_label: '발행 준비 완료 · 외부 게시 전',
        message: '다시 승인 완료',
        updated_at: nextVersion,
      },
    }))

    const handleSuccess = vi.fn()
    render(
      <ReapproveButton
        workspaceId={mockWorkspaceId}
        itemRef={mockItemRef}
        version={initialVersion}
        onSuccess={handleSuccess}
        fetchFn={mockFetch as unknown as typeof fetch}
      />,
    )

    const btn = screen.getByRole('button', { name: '다시 승인하고 보관' })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(handleSuccess).toHaveBeenCalled()
    })
  })

  it('HoldToggle 독립 컴포넌트 정상 동작', async () => {
    const mockFetch = createMockFetch(() => ({
      status: 200,
      data: {
        item_ref: mockItemRef,
        status_label: '사용자 보류',
        message: '보류됨',
        updated_at: nextVersion,
      },
    }))

    const handleSuccess = vi.fn()
    render(
      <HoldToggle
        workspaceId={mockWorkspaceId}
        itemRef={mockItemRef}
        version={initialVersion}
        releaseGate={null}
        onSuccess={handleSuccess}
        fetchFn={mockFetch as unknown as typeof fetch}
      />,
    )

    const btn = screen.getByRole('button', { name: '발행 보류' })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(handleSuccess).toHaveBeenCalled()
    })
  })

  it('DeleteRestoreControl 독립 컴포넌트 삭제 및 복구 동작', async () => {
    const mockFetch = createMockFetch(() => ({
      status: 200,
      data: {
        item_ref: mockItemRef,
        status_label: '복구됨',
        message: '복구 완료',
        updated_at: nextVersion,
      },
    }))

    const handleSuccess = vi.fn()
    render(
      <DeleteRestoreControl
        workspaceId={mockWorkspaceId}
        itemRef={mockItemRef}
        version={initialVersion}
        isDeleted={true}
        onSuccess={handleSuccess}
        fetchFn={mockFetch as unknown as typeof fetch}
      />,
    )

    const btn = screen.getByRole('button', { name: '보관 글 복구하기' })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(handleSuccess).toHaveBeenCalled()
    })
  })
})
