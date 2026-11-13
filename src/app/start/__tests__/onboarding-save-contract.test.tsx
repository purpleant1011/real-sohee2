// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * ANI-1781 (M03): 온보딩 저장 호출의 **요청 본문 계약**을 고정한다.
 *
 * 저장은 기존 명령(PATCH·POST /api/onboarding/quick-start)만 쓴다. 이 파일은
 * 1) 화면이 실제로 보내는 본문이 서버 스키마(quickStartProgressSchema·quickStartInputSchema)를 통과하는지
 * 2) workspace 는 본문이 아니라 `x-workspace-id` 헤더로만 가는지
 * 3) 실패 응답이 단계 진행으로 새지 않는지
 * 를 실제 fetch 호출 기록으로 확인한다.
 *
 * 실계정·OAuth 호출은 없다. 실 서버 구간은 증거 문서에서 'blocked: 실계정 필요'로 표기한다.
 */
const searchParams = vi.hoisted(() => ({ current: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => searchParams.current,
}))
vi.mock('@/components/start/start-wizard', () => ({ StartWizard: () => <p>start-wizard</p> }))
vi.mock('@/features/media/media-upload-card', () => ({
  MediaUploadCard: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="media-upload" data-workspace={workspaceId} />
  ),
}))

import OnboardingEntry from '../onboarding-entry'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { quickStartInputSchema, quickStartProgressSchema } from '@/features/quick-start/quick-start-service'

const WS = '11111111-1111-4111-8111-111111111111'
const SHOP = { business_name: '바이름', industry: '뷰티', location: '서울', summary: '동네 미용실' }

type ServerState = {
  profile: Record<string, string> | null
  tone: string | null
  textHarness: boolean
}

function jsonResponse(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as unknown as Response
}

function stubWidth(narrow = true) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: narrow,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

function renderEntry() {
  stubWidth()
  return render(
    <MobileR2Provider enabled>
      <OnboardingEntry />
    </MobileR2Provider>,
  )
}

let server: ServerState
let getStatus: number
let saveStatus: number
let savePayload: unknown
// 다른 탭이 덮어쓴 상황을 흉내 낸다 — 재조회만 이 값을 돌려준다(저장 자체는 정상 접수).
let getProfileOverride: Record<string, string> | null
let getToneOverride: string | null
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  server = { profile: null, tone: null, textHarness: false }
  getStatus = 200
  saveStatus = 200
  savePayload = { saved: true }
  getProfileOverride = null
  getToneOverride = null
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method === 'PATCH') {
      const body = JSON.parse(String(init?.body)) as Record<string, string>
      if (saveStatus < 300) {
        server.profile = {
          business_name: body.businessName,
          industry: body.industry,
          location: body.location,
          summary: body.summary,
        }
      }
      return jsonResponse(savePayload, saveStatus)
    }
    if (method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { tone: string }
      if (saveStatus < 300) {
        server.tone = body.tone
        server.textHarness = true
      }
      return jsonResponse(savePayload, saveStatus)
    }
    if (getStatus < 300) {
      return jsonResponse({
        workspaceId: WS,
        stage: 'PREPARE_ONLY',
        profile: getProfileOverride ?? server.profile,
        preferences:
          getToneOverride || server.tone ? { tone: getToneOverride ?? server.tone } : null,
        facts: {
          TEXT_HARNESS_CONFIRMED: server.textHarness,
          INSTAGRAM_VERIFIED: false,
          THREADS_VERIFIED: false,
        },
      })
    }
    return jsonResponse({ error: '가게 정보를 불러오지 못했어요.' }, getStatus)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function callsOf(method: string) {
  return fetchMock.mock.calls.filter(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === method)
}

async function fillShop() {
  await screen.findByRole('heading', { name: '가게 정보를 알려 주세요' })
  fireEvent.change(screen.getByLabelText('가게 이름'), { target: { value: '바이름' } })
  fireEvent.change(screen.getByLabelText('업종'), { target: { value: '뷰티' } })
  fireEvent.change(screen.getByLabelText('한 줄 소개'), { target: { value: '동네 미용실' } })
}

describe('저장 명령 요청 본문 계약', () => {
  it('가게 정보 PATCH: 본문은 4개 키뿐이고 서버 스키마를 통과하며 workspace 는 헤더로만 간다', async () => {
    renderEntry()
    await fillShop()
    fireEvent.click(screen.getByRole('button', { name: '저장하고 다음' }))

    await waitFor(() => expect(callsOf('PATCH')).toHaveLength(1))
    const [url, init] = callsOf('PATCH')[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>

    expect(url).toBe('/api/onboarding/quick-start')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect((init.headers as Record<string, string>)['x-workspace-id']).toBe(WS)
    // 키 집합을 통째로 고정한다 — workspaceId 가 본문으로 새면 여기서 깨진다.
    expect(Object.keys(body).sort()).toEqual(['businessName', 'industry', 'location', 'summary'])
    expect(body).toEqual({ businessName: '바이름', industry: '뷰티', location: '', summary: '동네 미용실' })
    // 화면이 보낸 본문은 서버가 실제로 파싱하는 스키마를 통과해야 한다.
    expect(quickStartProgressSchema.safeParse(body).success).toBe(true)
  })

  it('가게 정보를 고칠 때 서버에 저장된 location 을 잃지 않는다', async () => {
    server.profile = { ...SHOP, industry: '' }
    renderEntry()
    await screen.findByRole('heading', { name: '가게 정보를 알려 주세요' })
    fireEvent.change(screen.getByLabelText('업종'), { target: { value: '네일' } })
    fireEvent.click(screen.getByRole('button', { name: '저장하고 다음' }))

    await waitFor(() => expect(callsOf('PATCH')).toHaveLength(1))
    const body = JSON.parse(String((callsOf('PATCH')[0][1] as RequestInit).body))
    expect(body.location).toBe('서울')
  })

  it('말투 POST: 서버가 확인한 가게 정보 + tone 이고 서버 스키마를 통과한다', async () => {
    // 가게 정보는 완성, 말투만 미확정 → 2단계에서 시작한다.
    server.profile = { ...SHOP }
    renderEntry()
    await screen.findByRole('heading', { name: '소희가 글을 쓸 말투를 골라 주세요' })

    fireEvent.click(screen.getAllByRole('radio')[1])
    fireEvent.click(screen.getByRole('button', { name: '이 말투로 정하고 다음' }))

    await waitFor(() => expect(callsOf('POST')).toHaveLength(1))
    const [url, init] = callsOf('POST')[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>

    expect(url).toBe('/api/onboarding/quick-start')
    expect((init.headers as Record<string, string>)['x-workspace-id']).toBe(WS)
    expect(Object.keys(body).sort()).toEqual(['businessName', 'industry', 'location', 'summary', 'tone'])
    expect(body).toEqual({
      businessName: '바이름',
      industry: '뷰티',
      location: '서울',
      summary: '동네 미용실',
      tone: 'trendy',
    })
    expect(quickStartInputSchema.safeParse(body).success).toBe(true)
  })

  it('저장 뒤에는 캐시 없는 GET 으로 서버 진행을 다시 읽는다', async () => {
    renderEntry()
    await fillShop()
    fireEvent.click(screen.getByRole('button', { name: '저장하고 다음' }))
    await waitFor(() => expect(callsOf('GET').length).toBeGreaterThanOrEqual(2))

    const gets = callsOf('GET') as [string, RequestInit][]
    expect(gets.every(([url, init]) => url === '/api/onboarding/quick-start' && init.cache === 'no-store')).toBe(true)
  })
})

describe('저장 실패 응답 계약', () => {
  it('422 응답의 서버 문구를 그대로 보여주고 다음 단계로 넘어가지 않는다', async () => {
    saveStatus = 422
    savePayload = { error: '가게 이름과 입력한 내용을 확인해 주세요.', code: 'INVALID_INPUT' }
    renderEntry()
    await fillShop()
    fireEvent.click(screen.getByRole('button', { name: '저장하고 다음' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('가게 이름과 입력한 내용을 확인해 주세요.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '가게 정보를 알려 주세요' })).toBeTruthy()
  })

  it('본문이 JSON 이 아닌 실패 응답이어도 기본 문구로 막고 단계는 그대로 둔다', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return { ok: false, status: 503, json: async () => { throw new Error('not json') } } as unknown as Response
      }
      return jsonResponse({
        workspaceId: WS,
        stage: 'PREPARE_ONLY',
        profile: null,
        preferences: null,
        facts: { TEXT_HARNESS_CONFIRMED: false, INSTAGRAM_VERIFIED: false, THREADS_VERIFIED: false },
      })
    })
    renderEntry()
    await fillShop()
    fireEvent.click(screen.getByRole('button', { name: '저장하고 다음' }))

    expect(await screen.findByText('가게 정보를 저장하지 못했어요. 다시 시도해 주세요.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '가게 정보를 알려 주세요' })).toBeTruthy()
  })
})

describe('실 서버 응답 5상태', () => {
  it('저장 값이 없는 정상 응답은 빈 상태(오류 아님)로 안내한다', async () => {
    renderEntry()
    expect(await screen.findByRole('heading', { name: '가게 정보를 알려 주세요' })).toBeTruthy()
    expect(screen.getByText(/아직 저장된 가게 정보가 없어요/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '가게 정보를 불러오지 못했어요' })).toBeNull()
  })

  it('2xx 인데 형식이 계약 밖이면 빈 상태가 아니라 판정 불가(unknown → 오류 화면)다', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ success: true }))
    renderEntry()
    expect(await screen.findByRole('heading', { name: '가게 정보를 불러오지 못했어요' })).toBeTruthy()
    expect(screen.queryByLabelText('가게 이름')).toBeNull()
  })

  it('연결 실패는 빈 폼이 아니라 오류 화면과 다시 확인이다', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('offline')
    })
    renderEntry()
    expect(await screen.findByRole('heading', { name: '가게 정보를 불러오지 못했어요' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '다시 확인' })).toBeTruthy()
  })

  it('저장은 접수됐지만 확인 재조회가 실패하면 성공으로 넘기지 않고 stale 을 유지한다', async () => {
    server.profile = { ...SHOP, industry: '' }
    renderEntry()
    await screen.findByRole('heading', { name: '가게 정보를 알려 주세요' })

    getStatus = 503 // 저장(PATCH)은 성공, 그 뒤 재조회만 실패
    fireEvent.change(screen.getByLabelText('업종'), { target: { value: '네일' } })
    fireEvent.click(screen.getByRole('button', { name: '저장하고 다음' }))

    // 2xx 는 접수일 뿐 — 확인 전에는 성공 문구를 띄우거나 다음 단계로 넘어가지 않는다.
    expect(
      await screen.findByText('저장은 접수됐지만 최신 상태를 확인하지 못했어요. 다시 확인을 눌러 주세요.'),
    ).toBeTruthy()
    expect(screen.getByText('이전에 확인한 내용이에요')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '가게 정보를 알려 주세요' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '소희가 글을 쓸 말투를 골라 주세요' })).toBeNull()
    // 오류 화면으로 내용을 지우지 않는다.
    expect(screen.queryByRole('heading', { name: '가게 정보를 불러오지 못했어요' })).toBeNull()
  })

  it('stale 화면의 다시 확인으로 재조회가 성공하면 최신 내용으로 이어진다', async () => {
    server.profile = { ...SHOP, industry: '' }
    renderEntry()
    await screen.findByRole('heading', { name: '가게 정보를 알려 주세요' })

    getStatus = 503
    fireEvent.change(screen.getByLabelText('업종'), { target: { value: '네일' } })
    fireEvent.click(screen.getByRole('button', { name: '저장하고 다음' }))
    await screen.findByText('이전에 확인한 내용이에요')

    getStatus = 200
    fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))

    expect(await screen.findByRole('heading', { name: '소희가 글을 쓸 말투를 골라 주세요' })).toBeTruthy()
    expect(screen.queryByText('이전에 확인한 내용이에요')).toBeNull()
  })
})

describe('쓰기 확인은 값 일치까지 — ready 만으로 성공이 아니다', () => {
  it('재조회 값이 보낸 가게 정보와 다르면 성공으로 넘기지 않고 stale 로 막는다', async () => {
    server.profile = { ...SHOP, industry: '' }
    renderEntry()
    await screen.findByRole('heading', { name: '가게 정보를 알려 주세요' })

    // 저장은 접수되지만, 다른 탭이 저장한 옛 값이 재조회로 돌아온다.
    getProfileOverride = { ...SHOP }

    fireEvent.change(screen.getByLabelText('업종'), { target: { value: '네일' } })
    fireEvent.click(screen.getByRole('button', { name: '저장하고 다음' }))

    expect(
      await screen.findByText('저장은 접수됐지만 다른 곳에서 내용이 바뀐 것 같아요. 다시 확인해 주세요.'),
    ).toBeTruthy()
    expect(screen.getByText('이전에 확인한 내용이에요')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '가게 정보를 알려 주세요' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '소희가 글을 쓸 말투를 골라 주세요' })).toBeNull()
  })

  it('재조회 말투가 고른 말투와 다르면 다음 단계로 넘기지 않는다', async () => {
    server.profile = { ...SHOP }
    renderEntry()
    await screen.findByRole('heading', { name: '소희가 글을 쓸 말투를 골라 주세요' })

    getToneOverride = 'calm' // 다른 곳에서 고른 말투가 남아 있다

    fireEvent.click(screen.getAllByRole('radio')[1])
    fireEvent.click(screen.getByRole('button', { name: '이 말투로 정하고 다음' }))

    expect(
      await screen.findByText('저장은 접수됐지만 다른 곳에서 내용이 바뀐 것 같아요. 다시 확인해 주세요.'),
    ).toBeTruthy()
    expect(screen.getByText('이전에 확인한 내용이에요')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '소희가 글을 쓸 말투를 골라 주세요' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '글을 올릴 계정을 연결해 주세요' })).toBeNull()
  })
})
