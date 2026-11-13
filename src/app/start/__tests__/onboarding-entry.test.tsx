// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * ANI-1781 (M03): R2 가게 소개 화면이 실제로 저장까지 하는지 확인한다.
 *
 * 저장은 기존 온보딩 명령(PATCH/POST /api/onboarding/quick-start)만 쓴다 — 새 쓰기 경로를 만들지 않는다.
 * 진행 복원은 서버가 준 값만 쓴다.
 */
const searchParams = vi.hoisted(() => ({ current: new URLSearchParams() }))
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams.current,
}))
vi.mock('@/components/start/start-wizard', () => ({ StartWizard: () => <p>start-wizard</p> }))
vi.mock('@/features/media/media-upload-card', () => ({
  MediaUploadCard: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="media-upload" data-workspace={workspaceId} />
  ),
}))

import OnboardingEntry from '../onboarding-entry'
import { StartWizard } from '@/components/start/start-wizard'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'

const WS = '11111111-1111-4111-8111-111111111111'

function jsonResponse(data: unknown, ok = true): Response {
  // 실제 Response 처럼 status 도 내려준다 — 화면은 ok 가 아니라 status 로 5상태를 가른다.
  return { ok, status: ok ? 200 : 500, json: async () => data } as unknown as Response
}

function stubWidth(narrow: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: narrow,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

function renderEntry(enabled = true, narrow = true) {
  stubWidth(narrow)
  return render(
    <MobileR2Provider enabled={enabled}>
      <OnboardingEntry />
    </MobileR2Provider>,
  )
}

let profile: Record<string, string> | null = null
let savedTone: string | null = null
let harnessConfirmed = false
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  profile = null
  savedTone = null
  harnessConfirmed = false
  searchParams.current = new URLSearchParams()
  push.mockClear()
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as {
        businessName: string; industry: string; location: string; summary: string
      }
      profile = {
        business_name: body.businessName,
        industry: body.industry,
        location: body.location,
        summary: body.summary,
      }
      return jsonResponse({ saved: true })
    }
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { tone: string }
      savedTone = body.tone
      // 말투 저장은 서버의 글 쓰기 기준 확정을 뜻한다 — 다음 조회에서 3단계(계정)로 이어진다.
      harnessConfirmed = true
      return jsonResponse({ saved: true })
    }
    return jsonResponse({
      workspaceId: WS,
      stage: 'PREPARE_ONLY',
      profile,
      preferences: savedTone ? { tone: savedTone } : null,
      facts: {
        TEXT_HARNESS_CONFIRMED: harnessConfirmed,
        INSTAGRAM_VERIFIED: false,
        THREADS_VERIFIED: false,
      },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('M03 온보딩 진입점 — 실제 입력·저장', () => {
  it('서버 진행을 읽어 1단계 가게 정보를 보여준다', async () => {
    renderEntry()
    expect(await screen.findByRole('heading', { name: '가게 정보를 알려 주세요' })).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/onboarding/quick-start', expect.objectContaining({ cache: 'no-store' }))
    expect(screen.getByTestId('media-upload').getAttribute('data-workspace')).toBe(WS)
  })

  it('입력한 가게 정보를 기존 저장 명령(PATCH)으로 보내고 다음 단계로 넘어간다', async () => {
    renderEntry()
    await screen.findByRole('heading', { name: '가게 정보를 알려 주세요' })

    fireEvent.change(screen.getByLabelText('가게 이름'), { target: { value: '바이름' } })
    fireEvent.change(screen.getByLabelText('업종'), { target: { value: '뷰티' } })
    fireEvent.change(screen.getByLabelText('한 줄 소개'), { target: { value: '동네 미용실' } })
    fireEvent.click(screen.getByRole('button', { name: '저장하고 다음' }))

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
      expect(patch).toBeTruthy()
      const [url, init] = patch as [string, RequestInit]
      expect(url).toBe('/api/onboarding/quick-start')
      expect((init.headers as Record<string, string>)['x-workspace-id']).toBe(WS)
      expect(JSON.parse(String(init.body))).toEqual({
        businessName: '바이름',
        industry: '뷰티',
        location: '',
        summary: '동네 미용실',
      })
    })

    // 저장 뒤 서버 값을 다시 읽어 다음 단계(말투)로 이어진다.
    expect(await screen.findByRole('heading', { name: '소희가 글을 쓸 말투를 골라 주세요' })).toBeTruthy()
  })

  it('조회에 실패하면 빈 폼이 아니라 실패 화면을 보여주고 다시 확인을 제공한다', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ error: 'nope' }, false))
    renderEntry()
    expect(await screen.findByRole('heading', { name: '가게 정보를 불러오지 못했어요' })).toBeTruthy()
    expect(screen.queryByLabelText('가게 이름')).toBeNull()
    expect(screen.getByRole('button', { name: '다시 확인' })).toBeTruthy()
  })

  it('랜딩에서 고른 업종을 첫 단계 업종 칸에 미리 채운다(저장 값이 없을 때만)', async () => {
    searchParams.current = new URLSearchParams('industry=beauty')
    renderEntry()
    await screen.findByRole('heading', { name: '가게 정보를 알려 주세요' })
    expect((screen.getByLabelText('업종') as HTMLInputElement).value).toBe('뷰티')
    // 읽기만 한다 — 조회 전에 저장 명령을 부르지 않는다.
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method)).toBe(false)
  })

  it('알 수 없는 업종 값은 폼에 쓰지 않는다', async () => {
    searchParams.current = new URLSearchParams('industry=__import__')
    renderEntry()
    await screen.findByRole('heading', { name: '가게 정보를 알려 주세요' })
    expect((screen.getByLabelText('업종') as HTMLInputElement).value).toBe('')
  })

  it('넓은 화면에서는 R2 화면을 그리지 않는다(조회도 하지 않는다)', async () => {
    renderEntry(true, false)
    expect(await screen.findByText('start-wizard')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('ANI-1674 M03 완료 기준 — 데스크톱 회귀와 3단계 완주', () => {
  it('1440px·플래그 OFF 는 기존 StartWizard 화면과 문자열까지 같게 그린다', async () => {
    const entry = renderEntry(false, false)
    expect(await screen.findByText('start-wizard')).toBeTruthy()

    const standalone = render(<StartWizard />)
    expect(entry.container.innerHTML).toBe(standalone.container.innerHTML)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('1440px·플래그 ON 이어도 넓은 화면은 StartWizard 그대로다(조회 없음)', async () => {
    renderEntry(true, false)
    expect(await screen.findByText('start-wizard')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '가게 소개' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('390px·플래그 ON 에서 가게 → 말투 → 계정 → 첫 글을 한 화면에서 완주한다', async () => {
    renderEntry(true, true)
    await screen.findByRole('heading', { name: '가게 정보를 알려 주세요' })

    // 1단계: 가게 정보 저장(PATCH)
    fireEvent.change(screen.getByLabelText('가게 이름'), { target: { value: '바이름' } })
    fireEvent.change(screen.getByLabelText('업종'), { target: { value: '뷰티' } })
    fireEvent.change(screen.getByLabelText('한 줄 소개'), { target: { value: '동네 미용실' } })
    fireEvent.click(screen.getByRole('button', { name: '저장하고 다음' }))

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
      expect(patch).toBeTruthy()
      const [url, init] = patch as [string, RequestInit]
      expect(url).toBe('/api/onboarding/quick-start')
      expect((init.headers as Record<string, string>)['x-workspace-id']).toBe(WS)
      expect(JSON.parse(String(init.body))).toEqual({
        businessName: '바이름',
        industry: '뷰티',
        location: '',
        summary: '동네 미용실',
      })
    })

    // 2단계: 말투 선택 저장(POST) — 서버가 확인한 프로필 값이 함께 실린다.
    await screen.findByRole('heading', { name: '소희가 글을 쓸 말투를 골라 주세요' })
    fireEvent.click(screen.getAllByRole('radio')[1])
    fireEvent.click(screen.getByRole('button', { name: '이 말투로 정하고 다음' }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
      expect(post).toBeTruthy()
      const [url, init] = post as [string, RequestInit]
      expect(url).toBe('/api/onboarding/quick-start')
      expect((init.headers as Record<string, string>)['x-workspace-id']).toBe(WS)
      expect(JSON.parse(String(init.body))).toEqual({
        businessName: '바이름',
        industry: '뷰티',
        location: '',
        summary: '동네 미용실',
        tone: 'trendy',
      })
    })

    // 3단계: 계정 연결은 나중으로 미루고 첫 글 미리보기까지 간다.
    expect(await screen.findByRole('heading', { name: '글을 올릴 계정을 연결해 주세요' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '나중에 연결하고 계속' }))
    expect(await screen.findByRole('heading', { name: '다음은 첫 글 미리보기예요' })).toBeTruthy()

    // 한 화면 안에서 단계만 넘어간다 — 라우터 이동은 없다.
    expect(push).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.every(([url]) => url === '/api/onboarding/quick-start')).toBe(true)
    const methods = fetchMock.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.method ?? 'GET')
    expect(methods.every(method => ['GET', 'PATCH', 'POST'].includes(method))).toBe(true)
  })

  // M03 계약은 재진입 시 진행 단계 복원을 요구한다. 지금은 '나중에 연결하고 계속'이 로컬 override 로만 남아
  // 재마운트하면 서버 값(채널 미검증)으로 다시 계산되어 계정 단계로 돌아온다 — 복원 갭을 회귀 테스트로 고정한다.
  // TODO(ANI-1674): 건너뛰기를 서버에 기록하게 되면 이 기대를 '미리보기 단계 복원'으로 바꾼다.
  it('계정 건너뛰기 진행은 서버에 남지 않아 재진입하면 계정 단계로 돌아온다', async () => {
    const first = renderEntry(true, true)
    await screen.findByRole('heading', { name: '가게 정보를 알려 주세요' })
    fireEvent.change(screen.getByLabelText('가게 이름'), { target: { value: '바이름' } })
    fireEvent.change(screen.getByLabelText('업종'), { target: { value: '뷰티' } })
    fireEvent.change(screen.getByLabelText('한 줄 소개'), { target: { value: '동네 미용실' } })
    fireEvent.click(screen.getByRole('button', { name: '저장하고 다음' }))
    await screen.findByRole('heading', { name: '소희가 글을 쓸 말투를 골라 주세요' })
    fireEvent.click(screen.getByRole('button', { name: '이 말투로 정하고 다음' }))
    await screen.findByRole('heading', { name: '글을 올릴 계정을 연결해 주세요' })
    fireEvent.click(screen.getByRole('button', { name: '나중에 연결하고 계속' }))
    expect(await screen.findByRole('heading', { name: '다음은 첫 글 미리보기예요' })).toBeTruthy()

    first.unmount()
    renderEntry(true, true)

    expect(await screen.findByRole('heading', { name: '글을 올릴 계정을 연결해 주세요' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '다음은 첫 글 미리보기예요' })).toBeNull()
  })
})
