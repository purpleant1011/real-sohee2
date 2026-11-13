import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MagicPhotoDropzone } from './magic-photo-dropzone'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'

const context = vi.hoisted(() => ({ workspaceId: '10000000-0000-4000-8000-000000000001', membershipRole: 'owner', actorId: '20000000-0000-4000-8000-000000000001' }))
const push = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/use-workspace-context', () => ({ useOptionalWorkspaceContext: () => context }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const workspaceId = context.workspaceId
const photoId = '60000000-0000-4000-8000-000000000001'
const endpoint = `/api/workspaces/${workspaceId}/quick-post`
function responses(options: { readFailure?: boolean; wrongPhoto?: boolean; badQuote?: boolean; sourceRejected?: boolean } = {}) {
  let missionId = ''
  let reads = 0
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/onboarding/media') return Response.json(init?.method === 'POST' ? { selected: true } : { items: [{ id: photoId, rights_status: 'confirmed', publish_eligibility: true }] })
    if (url === `${endpoint}?limit=1`) return Response.json({ credits: { photoDraftCost: options.badQuote ? null : 100 } })
    if (url === endpoint && init?.method === 'POST') {
      if (options.sourceRejected) return Response.json({ code: 'SOURCE_MEDIA_NOT_READY' }, { status: 400 })
      missionId = JSON.parse(String(init.body)).requestId
      return Response.json({ item: { missionId, imageIds: [photoId] } })
    }
    if (url === `${endpoint}/${missionId}`) {
      if (options.readFailure && reads++ === 0) return Response.json({ error: 'read failed' }, { status: 503 })
      return Response.json({ item: { missionId, imageIds: [options.wrongPhoto ? 'other-photo' : photoId] } })
    }
    throw new Error(`Unexpected fixture request: ${url}`)
  })
  return { fetcher, getMissionId: () => missionId }
}

async function choosePhoto() {
  fireEvent.click(screen.getByRole('button', { name: /사진으로 글 만들기/ }))
  fireEvent.click(await screen.findByRole('button', { name: '이 사진 선택' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '글 초안 만들기' })).toBeEnabled())
}

beforeEach(() => { context.workspaceId = workspaceId; context.membershipRole = 'owner'; context.actorId = '20000000-0000-4000-8000-000000000001'; push.mockClear() })

describe('MagicPhotoDropzone real photo preparation', () => {
  it.each(['compact', 'detailed'] as const)('waits for explicit selection and quoted owner confirmation in %s mode', async density => {
    const { fetcher, getMissionId } = responses()
    vi.stubGlobal('fetch', fetcher)
    render(<MagicPhotoDropzone workspaceId={workspaceId} density={density} />)
    expect(fetcher).not.toHaveBeenCalled()
    await choosePhoto()
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST' && JSON.parse(String(init.body)).sourceAssetIds)).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '글 초안 만들기' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/start/preview?missionId=${getMissionId()}`))
    const creation = fetcher.mock.calls.find(([url, init]) => url === endpoint && init?.method === 'POST')!
    expect(JSON.parse(String(creation[1]?.body))).toMatchObject({ requestId: getMissionId(), sourceAssetIds: [photoId], maxDraftCredits: 100 })
    expect(fetcher.mock.calls.some(([url]) => url === `${endpoint}/${getMissionId()}`)).toBe(true)
  })

  it('sends one creation command for repeated immediate preparation taps', async () => {
    const { fetcher, getMissionId } = responses()
    vi.stubGlobal('fetch', fetcher)
    render(<MagicPhotoDropzone workspaceId={workspaceId} />)
    await choosePhoto()
    const button = screen.getByRole('button', { name: '글 초안 만들기' })
    act(() => { button.click(); button.click() })
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/start/preview?missionId=${getMissionId()}`))
    expect(fetcher.mock.calls.filter(([url, init]) => url === endpoint && init?.method === 'POST')).toHaveLength(1)
  })

  it('uses explicit request and completion ports without global request interception', async () => {
    const { fetcher, getMissionId } = responses()
    const prepared = vi.fn()
    const globalRequest = vi.fn()
    vi.stubGlobal('fetch', globalRequest)
    render(<MagicPhotoDropzone workspaceId={workspaceId} fetcher={fetcher} onPrepared={prepared} />)
    await choosePhoto()
    fireEvent.click(screen.getByRole('button', { name: '글 초안 만들기' }))
    await waitFor(() => expect(prepared).toHaveBeenCalledWith(getMissionId()))
    expect(globalRequest).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('retries stored draft readback without issuing a second creation command', async () => {
    const { fetcher, getMissionId } = responses({ readFailure: true })
    vi.stubGlobal('fetch', fetcher)
    render(<MagicPhotoDropzone workspaceId={workspaceId} />)
    await choosePhoto()
    fireEvent.click(screen.getByRole('button', { name: '글 초안 만들기' }))
    await screen.findByRole('alert')
    expect(push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '저장 상태 다시 확인' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/start/preview?missionId=${getMissionId()}`))
    expect(fetcher.mock.calls.filter(([url, init]) => url === endpoint && init?.method === 'POST')).toHaveLength(1)
  })

  it('keeps the latest selected photo when an old closed picker responds later', async () => {
    const secondPhoto = '60000000-0000-4000-8000-000000000002'
    let finishFirst!: (value: Response) => void
    let missionId = ''
    let usedPhoto = ''
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/onboarding/media') {
        if (init?.method === 'POST') return JSON.parse(String(init.body)).assetId === photoId
          ? new Promise<Response>(resolve => { finishFirst = resolve }) : Response.json({ selected: true })
        return Response.json({ items: [photoId, secondPhoto].map(id => ({ id, rights_status: 'confirmed', publish_eligibility: true })) })
      }
      if (url === `${endpoint}?limit=1`) return Response.json({ credits: { photoDraftCost: 100 } })
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)); missionId = body.requestId; usedPhoto = body.sourceAssetIds[0]
        return Response.json({ item: { missionId, imageIds: [usedPhoto] } })
      }
      return Response.json({ item: { missionId, imageIds: [usedPhoto] } })
    })
    vi.stubGlobal('fetch', fetcher)
    render(<MagicPhotoDropzone workspaceId={workspaceId} />)
    const toggle = screen.getByRole('button', { name: /사진으로 글 만들기/ })
    fireEvent.click(toggle)
    fireEvent.click((await screen.findAllByRole('button', { name: '이 사진 선택' }))[0])
    await waitFor(() => expect(finishFirst).toBeDefined())
    fireEvent.click(toggle); fireEvent.click(toggle)
    fireEvent.click((await screen.findAllByRole('button', { name: '이 사진 선택' }))[1])
    await waitFor(() => expect(screen.getByRole('button', { name: '글 초안 만들기' })).toBeEnabled())
    await act(async () => finishFirst(Response.json({ selected: true })))
    fireEvent.click(screen.getByRole('button', { name: '글 초안 만들기' }))
    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(usedPhoto).toBe(secondPhoto)
  })

  it('does not open a draft whose stored image differs from the selected original', async () => {
    const { fetcher } = responses({ wrongPhoto: true })
    vi.stubGlobal('fetch', fetcher)
    render(<MagicPhotoDropzone workspaceId={workspaceId} />)
    await choosePhoto()
    fireEvent.click(screen.getByRole('button', { name: '글 초안 만들기' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('선택한 원본 사진')
    expect(alert).toHaveTextContent('작업 탭에서 원고를 확인해 주세요')
    expect(push).not.toHaveBeenCalled()
  })

  it('unlocks photo correction after the server rejects original rights before creation', async () => {
    const { fetcher } = responses({ sourceRejected: true })
    vi.stubGlobal('fetch', fetcher)
    render(<MagicPhotoDropzone workspaceId={workspaceId} />)
    await choosePhoto()
    fireEvent.click(screen.getByRole('button', { name: '글 초안 만들기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('사진의 저장 상태와 사용 권리')
    expect(screen.getByLabelText('전하고 싶은 소식 (선택)')).toBeEnabled()
    expect(await screen.findByRole('button', { name: '이 사진 선택' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '글 초안 만들기' })).toBeDisabled()
    expect(push).not.toHaveBeenCalled()
  })

  it('does not guess a generation price when the server quote is missing', async () => {
    const { fetcher } = responses({ badQuote: true })
    vi.stubGlobal('fetch', fetcher)
    render(<MagicPhotoDropzone workspaceId={workspaceId} />)
    fireEvent.click(screen.getByRole('button', { name: /사진으로 글 만들기/ }))
    fireEvent.click(await screen.findByRole('button', { name: '이 사진 선택' }))
    expect(await screen.findByText('제작 비용을 확인하지 못했어요. 다시 확인해 주세요.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '글 초안 만들기' })).toBeDisabled()
    expect(fetcher.mock.calls.filter(([url, init]) => url === endpoint && init?.method === 'POST')).toHaveLength(0)
  })

  it('does not offer a write action without manager authority', () => {
    context.membershipRole = 'viewer'
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    render(<MagicPhotoDropzone workspaceId={workspaceId} />)
    expect(screen.getByRole('button', { name: /사진으로 글 만들기/ })).toBeDisabled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['workspace', 'actor'])('ignores a late creation response after switching %s', async change => {
    const normal = responses()
    let finish!: (value: Response) => void
    let pendingId = ''
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === endpoint && init?.method === 'POST') {
        pendingId = JSON.parse(String(init.body)).requestId
        return new Promise<Response>(resolve => { finish = resolve })
      }
      if (pendingId && String(input) === `${endpoint}/${pendingId}`) return Response.json({ item: { missionId: pendingId, imageIds: [photoId] } })
      return normal.fetcher(input, init)
    })
    vi.stubGlobal('fetch', fetcher)
    const view = render(<MagicPhotoDropzone workspaceId={workspaceId} />)
    await choosePhoto()
    fireEvent.click(screen.getByRole('button', { name: '글 초안 만들기' }))
    await waitFor(() => expect(finish).toBeDefined())
    if (change === 'workspace') context.workspaceId = '10000000-0000-4000-8000-000000000002'
    else context.actorId = '20000000-0000-4000-8000-000000000002'
    view.rerender(<MagicPhotoDropzone workspaceId={context.workspaceId} />)
    await act(async () => finish(Response.json({ item: { missionId: pendingId, imageIds: [photoId] } })))
    expect(push).not.toHaveBeenCalled()
    expect(fetcher.mock.calls.some(([url]) => String(url) === `${endpoint}/${pendingId}`)).toBe(false)
    expect(screen.queryByRole('button', { name: '저장 상태 다시 확인' })).toBeNull()
  })

  it('모바일 R2 환경에서는 크레딧 수치나 소모 문구를 보이지 않고 "글 초안 만들기" 버튼만 노출한다', async () => {
    const normal = responses()
    vi.stubGlobal('fetch', normal.fetcher)
    render(
      <MobileR2Provider enabled={true} forceMobile={true}>
        <MagicPhotoDropzone workspaceId={workspaceId} />
      </MobileR2Provider>,
    )
    await choosePhoto()
    expect(screen.queryByText(/문안 제작은 최대 .* 크레딧이에요/)).toBeNull()
    expect(screen.queryByRole('button', { name: /크레딧 이내로 글 초안 만들기/ })).toBeNull()
    const prepareButton = screen.getByRole('button', { name: '글 초안 만들기' })
    expect(prepareButton).toBeEnabled()
  })

  it('접힌 상태에서는 한 줄 요약이 보이고, 펼쳤을 때는 쉬운 사장님 안내 문구가 노출된다', async () => {
    const { fetcher } = responses()
    vi.stubGlobal('fetch', fetcher)
    render(<MagicPhotoDropzone workspaceId={workspaceId} />)

    expect(screen.getByText('사진으로 글 만들기')).toBeInTheDocument()
    expect(screen.getByText('사진 한 장이면 소식 글 초안을 준비해요')).toBeInTheDocument()
    expect(screen.queryByText(/저장과 사용 권리가 확인된 원본/)).toBeNull()

    const toggle = screen.getByRole('button', { name: /사진으로 글 만들기/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText('사장님 사진 한 장으로 글 초안을 만들어요. 올리기 전에 꼭 확인하실 수 있어요.')).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: '이 사진 선택' }))
    expect(await screen.findByText('사진 원본 그대로')).toBeInTheDocument()
    expect(screen.queryByText(/새 AI 이미지는 만들지 않아요/)).toBeNull()
  })

  it('보이는 설명 문단 없이 시각 언어(아이콘·점·칩) 중심으로 표시된다', async () => {
    const { fetcher } = responses()
    vi.stubGlobal('fetch', fetcher)
    render(<MagicPhotoDropzone workspaceId={workspaceId} />)

    fireEvent.click(screen.getByRole('button', { name: /사진으로 글 만들기/ }))

    // SheetDescription은 sr-only 클래스를 가져 시각적으로 보이지 않아야 함
    const description = await screen.findByText('사장님 사진 한 장으로 글 초안을 만들어요. 올리기 전에 꼭 확인하실 수 있어요.')
    expect(description).toHaveClass('sr-only')

    // 단계 힌트는 보이는 문자 없이 aria-label로만 점 제공
    const stepHint = screen.getByRole('img', { name: '1단계 사진 고르기' })
    expect(stepHint).toBeInTheDocument()
    expect(stepHint.textContent?.trim()).toBe('')

    // 사진 선택 후 2단계 힌트로 전환
    fireEvent.click(await screen.findByRole('button', { name: '이 사진 선택' }))
    const stepHint2 = await screen.findByRole('img', { name: '2단계 소식 적기' })
    expect(stepHint2).toBeInTheDocument()
    expect(stepHint2.textContent?.trim()).toBe('')

    // 긴 설명 문단 대신 작은 칩 노출
    expect(screen.queryByText('사진은 그대로 쓰고, 새로 그리지 않아요.')).toBeNull()
    expect(screen.getByText('사진 원본 그대로')).toBeInTheDocument()
  })

  it('기본 CTA 버튼이 하단 고정 바(photo-post-footer) 안에 위치한다', async () => {
    const { fetcher } = responses()
    vi.stubGlobal('fetch', fetcher)
    render(<MagicPhotoDropzone workspaceId={workspaceId} />)

    await choosePhoto()
    const footer = screen.getByTestId('photo-post-footer')
    expect(footer).toBeInTheDocument()
    const ctaButton = within(footer).getByRole('button', { name: /글 초안 만들기/ })
    expect(ctaButton).toBeInTheDocument()
  })

  it('모바일(MobileR2Provider forceMobile) 환경에서 크레딧 관련 문구가 일절 노출되지 않는다', async () => {
    const { fetcher } = responses()
    vi.stubGlobal('fetch', fetcher)
    render(
      <MobileR2Provider enabled={true} forceMobile={true}>
        <MagicPhotoDropzone workspaceId={workspaceId} />
      </MobileR2Provider>,
    )
    await choosePhoto()
    expect(screen.queryByText(/크레딧/)).toBeNull()
    const footer = screen.getByTestId('photo-post-footer')
    expect(within(footer).getByRole('button', { name: '글 초안 만들기' })).toBeInTheDocument()
  })

  it('시트가 열렸을 때 44px 이상의 명시적 닫기 버튼이 존재하고, 클릭 시 닫힌다', async () => {
    const { fetcher } = responses()
    vi.stubGlobal('fetch', fetcher)
    render(<MagicPhotoDropzone workspaceId={workspaceId} />)

    const toggle = screen.getByRole('button', { name: /사진으로 글 만들기/ })
    fireEvent.click(toggle)

    const closeButton = await screen.findByRole('button', { name: '닫기' })
    expect(closeButton).toBeInTheDocument()
    expect(closeButton.className).toMatch(/size-11|min-h-11|min-w-11|h-11|w-11/)

    fireEvent.click(closeButton)
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: '사진으로 글 만들기' })).toBeNull()
    })
  })
})
