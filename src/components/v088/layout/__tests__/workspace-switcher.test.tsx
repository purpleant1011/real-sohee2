import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSwitcher, parseWorkspaceListPayload } from '../workspace-switcher'

const STORE_A = '10000000-0000-4000-8000-000000000001'
const STORE_B = '10000000-0000-4000-8000-000000000002'

function response(payload: unknown, init: Readonly<{ ok?: boolean; status?: number }> = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => payload,
  } as Response
}

function readyList(activeId = STORE_A, fellBack = false) {
  return {
    data: {
      loadState: 'ready',
      workspaces: [
        { id: STORE_A, name: '바이름 강남점', role: 'owner' },
        { id: STORE_B, name: null, role: 'manager' },
      ],
      activeId,
      fellBack,
    },
  }
}

function installFetch(handlers: Readonly<{
  list?: () => Promise<Response> | Response
  active?: (body: { workspaceId: string }) => Promise<Response> | Response
}>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/workspaces')) {
      return handlers.list ? handlers.list() : response(readyList())
    }
    if (url.endsWith('/api/workspaces/active')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { workspaceId: string }
      return handlers.active ? handlers.active(body) : response({ data: { activeId: body.workspaceId } })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WorkspaceSwitcher', () => {
  it('서버가 확인한 가게 이름을 버튼 라벨로 보여준다', () => {
    installFetch({})
    render(<WorkspaceSwitcher activeId={STORE_A} activeName="바이름 강남점" />)

    const trigger = screen.getByRole('button', { name: '가게 선택: 바이름 강남점' })
    expect(trigger).toHaveTextContent('바이름 강남점')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('이름을 확인하지 못했으면 추측하지 않고 확인 중으로 표시한다', () => {
    installFetch({})
    render(<WorkspaceSwitcher activeId={STORE_A} activeName={null} />)

    expect(screen.getByRole('button', { name: '가게 선택: 가게 이름 확인 중' })).toBeInTheDocument()
  })

  it('fallback 으로 열렸으면 그 사실을 화면에 알린다', () => {
    installFetch({})
    render(<WorkspaceSwitcher activeId={STORE_A} activeName="바이름 강남점" fellBack />)

    expect(screen.getByText('선택한 가게에 접근할 수 없어 지금 가게로 열었어요.')).toBeInTheDocument()
  })

  it('열면 목록을 불러와 현재 가게를 선택 상태로 표시한다', async () => {
    const fetchMock = installFetch({})
    render(<WorkspaceSwitcher activeId={STORE_A} activeName="바이름 강남점" />)

    fireEvent.click(screen.getByRole('button', { name: '가게 선택: 바이름 강남점' }))

    const items = await screen.findAllByRole('menuitemradio')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveAttribute('aria-checked', 'true')
    expect(items[1]).toHaveAttribute('aria-checked', 'false')
    // 이름이 없는 가게는 추측하지 않는다.
    expect(items[1]).toHaveTextContent('이름 미확인')
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces', expect.objectContaining({ cache: 'no-store' }))
  })

  it('목록 조회 실패는 0건으로 보이지 않고 재시도할 수 있다', async () => {
    let attempts = 0
    installFetch({
      list: () => {
        attempts += 1
        return attempts === 1 ? response({ error: { code: 'WORKSPACE_LIST_UNAVAILABLE' } }, { ok: false, status: 500 }) : response(readyList())
      },
    })
    render(<WorkspaceSwitcher activeId={STORE_A} activeName="바이름 강남점" />)

    fireEvent.click(screen.getByRole('button', { name: '가게 선택: 바이름 강남점' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('가게 목록을 불러오지 못했어요.')

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('menuitemradio', { name: /바이름 강남점/ })).toBeInTheDocument()
  })

  it('활성 가게가 0건이면 연결된 가게가 없다고 알린다', async () => {
    installFetch({
      list: () => response({ data: { loadState: 'empty', workspaces: [], activeId: null, fellBack: false } }),
    })
    render(<WorkspaceSwitcher activeId={STORE_A} activeName="바이름 강남점" />)

    fireEvent.click(screen.getByRole('button', { name: '가게 선택: 바이름 강남점' }))

    expect(await screen.findByText('연결된 가게가 없어요.')).toBeInTheDocument()
  })

  it('다른 가게를 고르면 서버 재검증 API 로 저장하고 화면을 다시 연다', async () => {
    const fetchMock = installFetch({})
    const onSwitched = vi.fn()
    render(
      <WorkspaceSwitcher activeId={STORE_A} activeName="바이름 강남점" onSwitched={onSwitched} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '가게 선택: 바이름 강남점' }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /이름 미확인/ }))

    await waitFor(() => expect(onSwitched).toHaveBeenCalledTimes(1))
    const postCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/workspaces/active'))
    expect(postCall).toBeDefined()
    expect(postCall?.[1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({ workspaceId: STORE_B })
  })

  it('전환을 거부당하면 이전 가게를 유지하고 실패를 알린다', async () => {
    installFetch({
      active: () => response({ error: { code: 'WORKSPACE_FORBIDDEN' } }, { ok: false, status: 403 }),
    })
    const onSwitched = vi.fn()
    render(
      <WorkspaceSwitcher activeId={STORE_A} activeName="바이름 강남점" onSwitched={onSwitched} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '가게 선택: 바이름 강남점' }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /이름 미확인/ }))

    expect(await screen.findByText('이 가게에 접근할 권한이 없어요.')).toBeInTheDocument()
    expect(onSwitched).not.toHaveBeenCalled()
    // 표시 이름(열려 있는 가게)은 그대로다.
    expect(screen.getByRole('button', { name: '가게 선택: 바이름 강남점' })).toBeInTheDocument()
  })

  it('전환 중 서버 오류도 성공으로 위장하지 않는다', async () => {
    installFetch({
      active: () => response({ error: { code: 'WORKSPACE_SELECTION_UNAVAILABLE' } }, { ok: false, status: 500 }),
    })
    const onSwitched = vi.fn()
    render(
      <WorkspaceSwitcher activeId={STORE_A} activeName="바이름 강남점" onSwitched={onSwitched} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '가게 선택: 바이름 강남점' }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /이름 미확인/ }))

    expect(await screen.findByText('가게를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.')).toBeInTheDocument()
    expect(onSwitched).not.toHaveBeenCalled()
  })

  it('활성 가게가 1개면 선택기를 열지 않고 이름만 보여 준다', () => {
    const fetchMock = installFetch({})
    render(<WorkspaceSwitcher activeId={STORE_A} activeName="바이름 강남점" switchable={false} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('바이름 강남점')).toBeInTheDocument()
    // 전환 대상이 없으므로 목록 API 를 부르지 않는다.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('활성 가게가 1개여도 접근 불가 안내는 그대로 보여 준다', () => {
    installFetch({})
    render(
      <WorkspaceSwitcher activeId={STORE_A} activeName="바이름 강남점" fellBack switchable={false} />,
    )

    expect(screen.getByText('선택한 가게에 접근할 수 없어 지금 가게로 열었어요.')).toBeInTheDocument()
  })

  it('Escape 로 목록을 닫는다', async () => {
    installFetch({})
    render(<WorkspaceSwitcher activeId={STORE_A} activeName="바이름 강남점" />)

    const trigger = screen.getByRole('button', { name: '가게 선택: 바이름 강남점' })
    fireEvent.click(trigger)
    await screen.findByRole('menu', { name: '가게 목록' })

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('menu', { name: '가게 목록' })).not.toBeInTheDocument())
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('parseWorkspaceListPayload', () => {
  it('계약과 다른 응답은 null 로 거절한다', () => {
    expect(parseWorkspaceListPayload(null)).toBeNull()
    expect(parseWorkspaceListPayload({ data: { loadState: 'weird' } })).toBeNull()
    expect(parseWorkspaceListPayload({ data: { loadState: 'ready', workspaces: 'nope' } })).toBeNull()
    expect(parseWorkspaceListPayload({ data: { loadState: 'ready', workspaces: [{ name: '이름' }] } })).toBeNull()
  })

  it('빈 이름은 null 로 정규화한다', () => {
    const parsed = parseWorkspaceListPayload({
      data: { loadState: 'ready', workspaces: [{ id: STORE_A, name: '   ', role: 'owner' }] },
    })
    expect(parsed?.items).toEqual([{ id: STORE_A, name: null, role: 'owner' }])
  })
})
