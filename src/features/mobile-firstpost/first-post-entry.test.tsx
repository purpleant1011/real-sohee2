// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FirstPostEntry } from './first-post-entry'

// MediaUploadCard 테스트 모킹 (업로드 API 실제 실행 방지, workspaceId 전달 확인용)
vi.mock('@/features/media/media-upload-card', () => ({
  MediaUploadCard: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="media-upload-card" data-workspace-id={workspaceId}>
      가게 사진 업로드 카드
    </div>
  ),
}))

const res = (b: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s }))

describe('FirstPostEntry', () => {
  it('버튼을 누르기 전에는 아무 요청도 보내지 않는다', () => {
    const f = vi.fn()
    render(<FirstPostEntry workspaceId="ws-1" fetchImpl={f as unknown as typeof fetch} />)
    expect(f).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: '소희에게 맡기기' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('올바른 workspaceId가 제공되면 MediaUploadCard에 전달되고 발화 입력 폼이 노출된다', () => {
    render(<FirstPostEntry workspaceId="ws-test-123" />)
    const uploadCard = screen.getByTestId('media-upload-card')
    expect(uploadCard).toBeInTheDocument()
    expect(uploadCard).toHaveAttribute('data-workspace-id', 'ws-test-123')
    expect(screen.getByLabelText('알릴 내용')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '소희에게 맡기기' })).toBeInTheDocument()
  })

  it('workspaceId가 없으면 MediaUploadCard에 가짜 값을 넣지 않고 명시적 확인 불가 안내를 띄우며 생성 CTA를 차단한다', () => {
    const f = vi.fn()
    render(<FirstPostEntry fetchImpl={f as unknown as typeof fetch} />)
    // MediaUploadCard 미마운트 확인
    expect(screen.queryByTestId('media-upload-card')).not.toBeInTheDocument()
    // 명시적 확인 불가 안내 확인
    expect(screen.getByRole('alert')).toHaveTextContent('매장 정보를 확인하지 못했어요')
    // 생성 CTA 버튼 비활성화 확인
    const button = screen.getByRole('button', { name: '소희에게 맡기기' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)

    // 발화를 입력해도 CTA가 활성화되지 않고 요청을 보내지 않아야 함
    fireEvent.change(screen.getByLabelText('알릴 내용'), { target: { value: '신메뉴 알림' } })
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(f).not.toHaveBeenCalled()
  })

  it('initialDraft가 주어지면 workspaceId 유무와 관계없이 기존 복원 화면(FirstPostFlow)을 직접 원형으로 렌더링한다', () => {
    const draft = {
      datasetMode: 'ACTUAL',
      missionId: 'm-restored',
      copies: { instagram: { caption: '복원된 글', cta: '예약' } },
      channels: [{ provider: 'instagram', handle: '@a' }],
    }
    render(<FirstPostEntry initialDraft={draft} />)
    expect(document.querySelector('[data-first-post-preview]')).toBeTruthy()
    expect(screen.queryByTestId('media-upload-card')).not.toBeInTheDocument()
  })

  it('초안 생성 실패는 게시된 것이 없다고 알린다 (propose 요청 시 x-workspace-id 헤더 검증)', async () => {
    const f = vi.fn().mockReturnValue(res({ error: '준비가 안 됐어요' }, 403))
    render(<FirstPostEntry workspaceId="  ws-scoped-999  " fetchImpl={f as unknown as typeof fetch} />)
    fireEvent.change(screen.getByLabelText('알릴 내용'), { target: { value: '신메뉴' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 맡기기' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('준비가 안 됐어요'))

    // propose 요청에 x-workspace-id 헤더가 전달되었는지 실 fetch 인자 검증
    expect(f).toHaveBeenCalledTimes(1)
    expect(f).toHaveBeenCalledWith(
      '/api/missions/first-post/propose',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-workspace-id': 'ws-scoped-999',
        }),
        body: JSON.stringify({ utterance: '신메뉴' }),
      })
    )
  })

  it('restoreMissionId 가 있으면 저장된 초안을 조회해 복원한다 (새로고침 복원)', async () => {
    const stored = {
      datasetMode: 'ACTUAL',
      missionId: '11111111-1111-4111-8111-111111111111',
      copies: { instagram: { caption: '복원된 글', cta: '예약' } },
      channels: [{ provider: 'instagram', handle: '@a' }],
    }
    const f = vi.fn().mockReturnValue(res({ success: true, missionStatus: 'DRAFT', draft: stored }))
    render(<FirstPostEntry workspaceId="ws-1" restoreMissionId="11111111-1111-4111-8111-111111111111" fetchImpl={f as unknown as typeof fetch} />)

    await waitFor(() => expect(document.querySelector('[data-first-post-preview]')).toBeTruthy())
    expect(f).toHaveBeenCalledWith('/api/missions/first-post/11111111-1111-4111-8111-111111111111', expect.objectContaining({ headers: expect.objectContaining({ 'x-workspace-id': 'ws-1' }) }))
    expect(screen.queryByText('복원된 글')).toBeTruthy()
  })

  it('restoreMissionId 조회가 404 면 초안을 지어내지 않고 입력 화면을 유지한다', async () => {
    const f = vi.fn().mockReturnValue(res({ error: '없음' }, 404))
    render(<FirstPostEntry workspaceId="ws-1" restoreMissionId="22222222-2222-4222-8222-222222222222" fetchImpl={f as unknown as typeof fetch} />)

    await waitFor(() => expect(f).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText('알릴 내용')).toBeInTheDocument()
    expect(document.querySelector('[data-first-post-preview]')).toBeNull()
  })

  it('다른 mission/workspace 로 바뀌면 이전 scope 의 초안을 첫 페인트부터 숨긴다 (scope 누수 방지)', async () => {
    const stored = {
      datasetMode: 'ACTUAL',
      missionId: '33333333-3333-4333-8333-333333333333',
      copies: { instagram: { caption: 'A 미션 글', cta: '예약' } },
      channels: [{ provider: 'instagram', handle: '@a' }],
    }
    const f = vi.fn().mockReturnValue(res({ success: true, missionStatus: 'DRAFT', draft: stored }))
    const { rerender } = render(
      <FirstPostEntry workspaceId="ws-1" restoreMissionId="33333333-3333-4333-8333-333333333333" fetchImpl={f as unknown as typeof fetch} />,
    )
    await waitFor(() => expect(document.querySelector('[data-first-post-preview]')).toBeTruthy())

    // 같은 컴포넌트가 다른 미션으로 전환된다. 이전 초안이 한 프레임이라도 보이면 안 된다.
    rerender(
      <FirstPostEntry workspaceId="ws-1" restoreMissionId="44444444-4444-4444-8444-444444444444" fetchImpl={f as unknown as typeof fetch} />,
    )

    expect(document.querySelector('[data-first-post-preview]')).toBeNull()
    expect(screen.getByText('저장된 초안을 확인하는 중이에요.')).toBeInTheDocument()
  })

  it('늦게 도착한 이전 scope 조회 결과는 무시한다 (out-of-order)', async () => {
    let resolveA!: (value: Response) => void
    const slowA = new Promise<Response>((resolve) => {
      resolveA = resolve
    })
    const storedA = {
      datasetMode: 'ACTUAL',
      missionId: '33333333-3333-4333-8333-333333333333',
      copies: { instagram: { caption: 'A 미션 늦은 글', cta: '예약' } },
      channels: [{ provider: 'instagram', handle: '@a' }],
    }
    const f = vi.fn(() => slowA)
    const { rerender } = render(
      <FirstPostEntry workspaceId="ws-1" restoreMissionId="33333333-3333-4333-8333-333333333333" fetchImpl={f as unknown as typeof fetch} />,
    )

    rerender(
      <FirstPostEntry workspaceId="ws-1" restoreMissionId="44444444-4444-4444-8444-444444444444" fetchImpl={f as unknown as typeof fetch} />,
    )
    // A 의 응답이 이제서야 도착한다. B 화면에 A 초안이 그려지면 안 된다.
    resolveA(new Response(JSON.stringify({ success: true, missionStatus: 'DRAFT', draft: storedA }), { status: 200 }))

    await waitFor(() => expect(screen.getByText('저장된 초안을 확인하는 중이에요.')).toBeInTheDocument())
    expect(screen.queryByText('A 미션 늦은 글')).toBeNull()
    expect(document.querySelector('[data-first-post-preview]')).toBeNull()
  })

  it('복원 조회 실패는 초안 없음으로 숨기지 않고 확인 불가로 알린다', async () => {
    const f = vi.fn().mockReturnValue(res({ error: '없음' }, 404))
    render(<FirstPostEntry workspaceId="ws-1" restoreMissionId="77777777-7777-4777-8777-777777777777" fetchImpl={f as unknown as typeof fetch} />)

    await waitFor(() => expect(screen.getByText(/저장된 초안을 찾지 못했어요/)).toBeInTheDocument())
    // 자동 propose/publish 없음
    expect(f).toHaveBeenCalledTimes(1)
    expect(f).toHaveBeenCalledWith('/api/missions/first-post/77777777-7777-4777-8777-777777777777', expect.objectContaining({ headers: expect.objectContaining({ 'x-workspace-id': 'ws-1' }) }))
  })

  it('복원 확인 중에는 생성 CTA 가 차단되어 같은 미션 중복 propose 를 막는다', () => {
    const f = vi.fn(() => new Promise<Response>(() => {}))
    render(<FirstPostEntry workspaceId="ws-1" restoreMissionId="88888888-8888-4888-8888-888888888888" fetchImpl={f as unknown as typeof fetch} />)

    const button = screen.getByRole('button', { name: '소희에게 맡기기' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('알릴 내용'), { target: { value: '신메뉴' } })
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    // propose 는 한 번도 나가지 않는다
    expect(f).toHaveBeenCalledTimes(1)
    expect(f).toHaveBeenCalledWith('/api/missions/first-post/88888888-8888-4888-8888-888888888888', expect.objectContaining({ headers: expect.objectContaining({ 'x-workspace-id': 'ws-1' }) }))
  })

  it('복원이 timeout 된 뒤 새로 만든 초안을 늦은 옛 복원 결과가 덮어쓰지 않는다 (세대 차단)', async () => {
    let resolveRestore!: (value: Response) => void
    const slowRestore = new Promise<Response>((resolve) => {
      resolveRestore = resolve
    })
    const staleDraft = {
      datasetMode: 'ACTUAL',
      missionId: '55555555-5555-4555-8555-555555555555',
      copies: { instagram: { caption: '옛 초안 글', cta: '예약' } },
      channels: [{ provider: 'instagram', handle: '@a' }],
    }
    const freshDraft = {
      datasetMode: 'ACTUAL',
      missionId: '66666666-6666-4666-8666-666666666666',
      copies: { instagram: { caption: '새로 만든 글', cta: '예약' } },
      channels: [{ provider: 'instagram', handle: '@a' }],
    }
    const f = vi.fn((url: string) =>
      String(url).includes('/propose') ? res({ draft: freshDraft }) : slowRestore,
    )
    render(
      <FirstPostEntry
        workspaceId="ws-1"
        restoreMissionId="55555555-5555-4555-8555-555555555555"
        restoreTimeoutMs={5}
        fetchImpl={f as unknown as typeof fetch}
      />,
    )

    // 상한 시간이 지나 확인 불가로 열리면 사용자가 새로 만들 수 있다.
    await waitFor(() => expect(screen.getByText(/초안을 확인하지 못했어요/)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('알릴 내용'), { target: { value: '신메뉴' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 맡기기' }))
    await waitFor(() => expect(document.querySelector('[data-first-post-preview]')).toBeTruthy())

    // 이제서야 옛 복원 응답이 도착한다 — 새 초안을 덮으면 안 된다.
    resolveRestore(new Response(JSON.stringify({ draft: staleDraft }), { status: 200 }))
    await waitFor(() => expect(screen.queryByText('옛 초안 글')).toBeNull())
    expect(document.querySelector('[data-first-post-preview]')).toBeTruthy()
  })

  it('복원 401(인증 만료)은 정상 데이터로 오인하지 않고 fail-closed 로 닫는다', async () => {
    const f = vi.fn().mockReturnValue(res({ error: '인증 필요' }, 401))
    render(<FirstPostEntry workspaceId="ws-1" restoreMissionId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" fetchImpl={f as unknown as typeof fetch} />)

    await waitFor(() => expect(screen.getByText(/로그인이 만료됐어요/)).toBeInTheDocument())
    // 인증이 만료됐는데 새 초안을 만들게 두지 않는다(어차피 401 이고, 중복 시도 유도 금지).
    const button = screen.getByRole('button', { name: '소희에게 맡기기' }) as HTMLButtonElement
    fireEvent.change(screen.getByLabelText('알릴 내용'), { target: { value: '신메뉴' } })
    expect(button.disabled).toBe(true)
    expect(document.querySelector('[data-first-post-preview]')).toBeNull()
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('복원 401 은 safeFirstPostReturnPath 로 정규화된 로그인 복귀 링크를 제공한다 (open redirect 0)', async () => {
    const f = vi.fn().mockReturnValue(res({ error: '인증 필요' }, 401))
    render(<FirstPostEntry workspaceId="ws-1" restoreMissionId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" fetchImpl={f as unknown as typeof fetch} />)

    const link = await screen.findByRole('link', { name: '다시 로그인하기' })
    const href = link.getAttribute('href') ?? ''
    // 같은 출처 상대 경로 + 허용된 미션 경로만. 외부 URL·임의 step 승격 금지.
    expect(href.startsWith('/login?next=')).toBe(true)
    const next = decodeURIComponent(href.slice('/login?next='.length))
    expect(next).toBe('/app/missions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?step=preview')
    expect(next.startsWith('/')).toBe(true)
  })

  it('복원 offline 은 네트워크 안내로 닫고 생성 CTA 를 막는다', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    render(<FirstPostEntry workspaceId="ws-1" restoreMissionId="cccccccc-cccc-4ccc-8ccc-cccccccccccc" fetchImpl={f as unknown as typeof fetch} />)

    await waitFor(() => expect(screen.getByText(/네트워크에 연결되지 않았어요/)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('알릴 내용'), { target: { value: '신메뉴' } })
    expect((screen.getByRole('button', { name: '소희에게 맡기기' }) as HTMLButtonElement).disabled).toBe(true)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('복원 id 가 UUID 가 아니면 서버를 부르지 않고 중립 안내로 닫는다 (invalid_id)', async () => {
    const f = vi.fn()
    render(<FirstPostEntry workspaceId="ws-1" restoreMissionId="not-a-uuid" fetchImpl={f as unknown as typeof fetch} />)

    await waitFor(() => expect(screen.getByText(/저장된 초안을 찾지 못했어요/)).toBeInTheDocument())
    expect(f).not.toHaveBeenCalled()
    expect(document.querySelector('[data-first-post-preview]')).toBeNull()
  })

  it('복원 대기 중 언마운트되면 요청이 실제로 abort 된다 (cancelled)', async () => {
    const signals: AbortSignal[] = []
    const f = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal)
      return new Promise<Response>(() => {})
    })
    const { unmount } = render(
      <FirstPostEntry workspaceId="ws-1" restoreMissionId="dddddddd-dddd-4ddd-8ddd-dddddddddddd" fetchImpl={f as unknown as typeof fetch} />,
    )
    await waitFor(() => expect(signals.length).toBe(1))
    expect(signals[0].aborted).toBe(false)

    unmount()
    // 정리에서 실제 abort 가 걸려야 한다(결과만 버리는 것이 아님).
    await waitFor(() => expect(signals[0].aborted).toBe(true))
  })

  it('복원 403(권한 없음)도 초안 없음으로 뭉개지 않고 권한 안내로 닫는다', async () => {
    const f = vi.fn().mockReturnValue(res({ error: '권한 없음' }, 403))
    render(<FirstPostEntry workspaceId="ws-1" restoreMissionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" fetchImpl={f as unknown as typeof fetch} />)

    await waitFor(() => expect(screen.getByText(/볼 권한이 없어요/)).toBeInTheDocument())
    const button = screen.getByRole('button', { name: '소희에게 맡기기' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(document.querySelector('[data-first-post-preview]')).toBeNull()
  })

  it('같은 scope 에서 새 조회가 시작되면 늦게 도착한 옛 조회 결과가 새 결과를 덮지 않는다', async () => {
    let resolveOld!: (value: Response) => void
    const oldLoad = new Promise<Response>((resolve) => {
      resolveOld = resolve
    })
    const oldDraft = {
      datasetMode: 'ACTUAL',
      missionId: '99999999-9999-4999-8999-999999999999',
      copies: { instagram: { caption: '옛 조회 글', cta: '예약' } },
      channels: [{ provider: 'instagram', handle: '@a' }],
    }
    const newDraft = {
      datasetMode: 'ACTUAL',
      missionId: '99999999-9999-4999-8999-999999999999',
      copies: { instagram: { caption: '새 조회 글', cta: '예약' } },
      channels: [{ provider: 'instagram', handle: '@a' }],
    }
    const oldFetch = vi.fn(() => oldLoad)
    const newFetch = vi.fn().mockReturnValue(res({ success: true, missionStatus: 'DRAFT', draft: newDraft }))

    const { rerender } = render(
      <FirstPostEntry workspaceId="ws-1" restoreMissionId="99999999-9999-4999-8999-999999999999" fetchImpl={oldFetch as unknown as typeof fetch} />,
    )
    // 같은 mission/workspace 라도 조회 구현이 바뀌면 새 조회가 시작된다.
    rerender(
      <FirstPostEntry workspaceId="ws-1" restoreMissionId="99999999-9999-4999-8999-999999999999" fetchImpl={newFetch as unknown as typeof fetch} />,
    )
    await waitFor(() => expect(screen.getByText('새 조회 글')).toBeInTheDocument())

    // 옛 조회가 이제서야 도착한다 — 새 결과를 덮으면 안 된다.
    resolveOld(new Response(JSON.stringify({ draft: oldDraft }), { status: 200 }))
    await waitFor(() => expect(screen.queryByText('옛 조회 글')).toBeNull())
    expect(screen.getByText('새 조회 글')).toBeInTheDocument()
  })

  it('새 생성이 pending 인 동안 늦게 도착한 옛 복원 결과가 화면을 되돌리지 않는다', async () => {
    let resolveRestore!: (value: Response) => void
    const slowRestore = new Promise<Response>((resolve) => {
      resolveRestore = resolve
    })
    const staleDraft = {
      datasetMode: 'ACTUAL',
      missionId: '55555555-5555-4555-8555-555555555555',
      copies: { instagram: { caption: '옛 복원 글', cta: '예약' } },
      channels: [{ provider: 'instagram', handle: '@a' }],
    }
    const f = vi.fn((url: string) =>
      String(url).includes('/propose') ? new Promise<Response>(() => {}) : slowRestore,
    )
    render(
      <FirstPostEntry
        workspaceId="ws-1"
        restoreMissionId="55555555-5555-4555-8555-555555555555"
        restoreTimeoutMs={5}
        fetchImpl={f as unknown as typeof fetch}
      />,
    )

    await waitFor(() => expect(screen.getByText(/초안을 확인하지 못했어요/)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('알릴 내용'), { target: { value: '신메뉴' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 맡기기' }))
    // 생성 요청이 pending 인 상태
    await waitFor(() => expect(screen.getByRole('button', { name: '만드는 중' })).toBeInTheDocument())

    // 이제서야 옛 복원 응답이 도착한다 — 화면이 옛 초안으로 되돌아가면 안 된다.
    resolveRestore(new Response(JSON.stringify({ success: true, missionStatus: 'DRAFT', draft: staleDraft }), { status: 200 }))
    await waitFor(() => expect(screen.queryByText('옛 복원 글')).toBeNull())
    expect(document.querySelector('[data-first-post-preview]')).toBeNull()
    expect(screen.getByRole('button', { name: '만드는 중' })).toBeInTheDocument()
  })

  it('초안이 오면 미리보기로 넘어간다 (클라이언트 임의 draft 주입 없이 서버 응답 사용)', async () => {
    const draft = {
      datasetMode: 'ACTUAL',
      missionId: 'm',
      copies: { instagram: { caption: '글', cta: '예약' } },
      channels: [{ provider: 'instagram', handle: '@a' }],
    }
    const f = vi.fn().mockReturnValue(res({ draft }))
    render(
      <FirstPostEntry
        workspaceId="ws-1"
        fetchImpl={f as unknown as typeof fetch}
      />
    )
    fireEvent.change(screen.getByLabelText('알릴 내용'), { target: { value: '신메뉴' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 맡기기' }))
    await waitFor(() => expect(document.querySelector('[data-first-post-preview]')).toBeTruthy())

    expect(f).toHaveBeenCalledWith(
      '/api/missions/first-post/propose',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-workspace-id': 'ws-1',
        }),
      })
    )
  })
})
