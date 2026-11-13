import React from 'react'
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StartWizard } from '../start-wizard'

// 이 파일은 비동기 상태 로딩(위저드 초기 fetch)을 기다리므로 기본 대기 시간을 넉넉히 둔다.
configure({ asyncUtilTimeout: 5000 })

const routerMocks = vi.hoisted(() => ({ push: vi.fn() }))
const toastMocks = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
let mockSearchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => routerMocks,
  useSearchParams: () => ({
    get: (key: string) => mockSearchParams.get(key),
  }),
}))
vi.mock('sonner', () => ({ toast: toastMocks }))

const fetchMock = vi.fn()

function mockFetchRouter(options: {
  quickStart?: Record<string, unknown>
  verification?: Record<string, unknown>
} = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return { ok: true, json: async () => ({ success: true }) }
    }
    if (url.includes('/api/auth/business-verification')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          verification: {
            status: 'VERIFIED',
            hasDocument: true,
            isVerified: true,
            ...options.verification,
          },
        }),
      }
    }
    return {
      ok: true,
      json: async () => ({
        facts: { BUSINESS_VERIFIED: true },
        profile: null,
        ready: false,
        progressPercent: 0,
        ...options.quickStart,
      }),
    }
  })
}

beforeEach(() => {
  mockSearchParams = new URLSearchParams()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  mockFetchRouter()
})

describe('StartWizard', () => {
  it('saves shop and tone, then continues to the channel connection step', async () => {
    mockFetchRouter({
      quickStart: { facts: {}, profile: null, ready: false, progressPercent: 42 },
      verification: { status: 'VERIFIED', hasDocument: true },
    })
    render(<StartWizard />)
    await screen.findByText('어떤 가게인가요?')
    expect(screen.getByRole('progressbar', { name: '준비 진행률' })).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByText('우리 가게', { selector: 'li span' })).toBeInTheDocument()
    expect(screen.getByText('소희 말투', { selector: 'li span' })).toBeInTheDocument()
    expect(screen.getByText('계정 연결', { selector: 'li span' })).toBeInTheDocument()
    expect(screen.getByText('첫 글 미리보기 & 발행', { selector: 'li span' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('가게 이름'), { target: { value: '모모 카페' } })
    fireEvent.click(screen.getByRole('button', { name: '카페·디저트' }))
    fireEvent.change(screen.getByLabelText('우리 가게를 한두 문장으로 소개해 주세요'), { target: { value: '원두를 볶아요' } })
    fireEvent.click(screen.getByRole('button', { name: /다음: 소희 말투 고르기/ }))
    fireEvent.click(screen.getByRole('button', { name: /소희 첫 글 만들기/ }))
    await waitFor(() => expect(routerMocks.push).toHaveBeenCalledWith('/start?step=channels'))
    expect(await screen.findByText('게시물을 올릴 계정을 연결해 주세요')).toBeInTheDocument()
  })

  it('링크 없는 사장님: 사업자·운영 정보를 직접 입력해 저장 요청에 실을 수 있다', async () => {
    mockFetchRouter()
    render(<StartWizard />)
    await screen.findByText('어떤 가게인가요?')

    fireEvent.change(screen.getByLabelText('가게 이름'), { target: { value: '모모 카페' } })
    fireEvent.click(screen.getByRole('button', { name: '카페·디저트' }))
    fireEvent.change(screen.getByLabelText('우리 가게를 한두 문장으로 소개해 주세요'), { target: { value: '원두를 볶아요' } })

    // 접이식 섹션은 기본 닫힘 — 열어야 입력할 수 있다.
    const toggle = screen.getByRole('button', { name: /사업자·운영 정보 직접 입력/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    // 자가 입력은 인증이 아니라는 안내가 고정 노출된다.
    expect(screen.getByText(/사업자 인증과는 별개예요/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('사업자등록번호'), { target: { value: '000-00-00000' } })
    fireEvent.change(screen.getByLabelText('영업시간'), { target: { value: '평일 10:00~19:00' } })
    fireEvent.change(screen.getByLabelText('주차 안내'), { target: { value: '매장 앞 2대' } })

    // 체크섬 통과 표시
    expect(await screen.findByText('형식이 올바른 번호예요.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /다음: 소희 말투 고르기/ }))
    fireEvent.click(screen.getByRole('button', { name: /소희 첫 글 만들기/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/onboarding/quick-start', expect.objectContaining({ method: 'POST' })))
    const postCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/onboarding/quick-start' && init?.method === 'POST')
    expect(JSON.parse(postCall![1].body).businessDetails).toMatchObject({
      businessNumber: '0000000000',
      businessHours: '평일 10:00~19:00',
      parkingInfo: '매장 앞 2대',
    })
  })

  it('사업자·운영 정보를 하나도 안 적으면 저장 요청에 businessDetails 를 싣지 않는다', async () => {
    mockFetchRouter()
    render(<StartWizard />)
    await screen.findByText('어떤 가게인가요?')

    fireEvent.change(screen.getByLabelText('가게 이름'), { target: { value: '모모 카페' } })
    fireEvent.click(screen.getByRole('button', { name: '카페·디저트' }))
    fireEvent.change(screen.getByLabelText('우리 가게를 한두 문장으로 소개해 주세요'), { target: { value: '원두를 볶아요' } })
    fireEvent.click(screen.getByRole('button', { name: /다음: 소희 말투 고르기/ }))
    fireEvent.click(screen.getByRole('button', { name: /소희 첫 글 만들기/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/onboarding/quick-start', expect.objectContaining({ method: 'POST' })))
    const postCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/onboarding/quick-start' && init?.method === 'POST')
    expect(JSON.parse(postCall![1].body)).not.toHaveProperty('businessDetails')
  })

  it('저장된 사업자·운영 정보가 있으면 접이식 섹션이 펼쳐진 채 값이 복원된다', async () => {
    mockFetchRouter({
      quickStart: {
        facts: {},
        profile: null,
        businessDetails: {
          businessNumber: '0000000000',
          representativeName: '홍길동',
          businessHours: '평일 10:00~19:00',
          parkingInfo: '매장 앞 2대',
          intakeSource: 'manual',
        },
      },
    })
    render(<StartWizard />)
    await screen.findByText('어떤 가게인가요?')

    const toggle = screen.getByRole('button', { name: /사업자·운영 정보 직접 입력/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('영업시간')).toHaveValue('평일 10:00~19:00')
    expect(screen.getByLabelText('대표자명')).toHaveValue('홍길동')
  })

  it('requires the shop name, industry and description before continuing, then saves those fields', async () => {
    mockFetchRouter({
      verification: { status: 'PENDING', hasDocument: true },
    })
    render(<StartWizard />)
    await screen.findByText('어떤 가게인가요?')

    const next = screen.getByRole('button', { name: /다음: 소희 말투 고르기/ })
    expect(next).toBeDisabled()

    fireEvent.change(screen.getByLabelText('가게 이름'), { target: { value: '모모 카페' } })
    fireEvent.click(screen.getByRole('button', { name: '카페·디저트' }))
    fireEvent.change(screen.getByLabelText('우리 가게를 한두 문장으로 소개해 주세요'), { target: { value: '직접 로스팅한 원두를 사용해요.' } })
    expect(next).toBeEnabled()
    fireEvent.click(next)

    fireEvent.click(await screen.findByRole('button', { name: /소희 첫 글 만들기/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/onboarding/quick-start', expect.objectContaining({ method: 'POST' })))
    expect(routerMocks.push).toHaveBeenCalledWith('/start?step=channels')
    const postCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/onboarding/quick-start' && init?.method === 'POST')
    expect(postCall).toBeDefined()
    expect(JSON.parse(postCall![1].body)).toMatchObject({
      businessName: '모모 카페',
      industry: '카페·디저트',
      location: '',
      summary: '직접 로스팅한 원두를 사용해요.',
      tone: 'friendly',
    })
  })

  it('사업자 인증 미신청(NOT_STARTED) 상태여도 사장님이 먼저 가게 정보와 말투를 채울 수 있도록 우리 가게 단계를 보여준다', async () => {
    mockFetchRouter({
      verification: { status: 'NOT_STARTED', hasDocument: false },
      quickStart: { facts: { BUSINESS_VERIFIED: false } },
    })
    render(<StartWizard />)
    expect(await screen.findByText('어떤 가게인가요?')).toBeInTheDocument()
    expect(screen.getByText('우리 가게', { selector: 'li span' })).toBeInTheDocument()
  })

  it('신청 접수(PENDING + hasDocument) 상태면 바로 가게 입력 단계로 들어간다', async () => {
    mockFetchRouter({
      verification: { status: 'PENDING', hasDocument: true },
      quickStart: { facts: { BUSINESS_VERIFIED: false } },
    })
    render(<StartWizard />)
    expect(await screen.findByText('어떤 가게인가요?')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '사업자 인증' })).not.toBeInTheDocument()
  })

  it('승인 완료(VERIFIED) 상태면 바로 가게 입력 단계로 들어간다', async () => {
    mockFetchRouter({
      verification: { status: 'VERIFIED', hasDocument: false },
      quickStart: { facts: { BUSINESS_VERIFIED: true } },
    })
    render(<StartWizard />)
    expect(await screen.findByText('어떤 가게인가요?')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '사업자 인증' })).not.toBeInTheDocument()
  })

  it('channels step: disables main button when no channel connected and allows skip link', async () => {
    mockSearchParams = new URLSearchParams('step=channels')
    mockFetchRouter({
      verification: { status: 'VERIFIED', hasDocument: true },
      quickStart: {
        facts: {
          BUSINESS_KNOWLEDGE_CONFIRMED: true,
          TEXT_HARNESS_CONFIRMED: true,
          IMAGE_HARNESS_CONFIRMED: true,
          INSTAGRAM_VERIFIED: false,
          THREADS_VERIFIED: false,
        },
        profile: { business_name: '모모 카페', industry: '카페·디저트', summary: '원두' },
        ready: false,
        progressPercent: 50,
      },
    })
    render(<StartWizard />)
    expect(await screen.findByText('게시물을 올릴 계정을 연결해 주세요')).toBeInTheDocument()

    const mainBtn = screen.getByRole('button', { name: '연결 완료 · 첫 글 만들기' })
    expect(mainBtn).toBeDisabled()
    expect(screen.getByText('아직 연결하지 않아도 첫 글은 미리 볼 수 있어요')).toBeInTheDocument()

    const skipLink = screen.getByRole('button', { name: /나중에 연결할게요 · 첫 글 먼저 볼게요/ })
    fireEvent.click(skipLink)
    expect(routerMocks.push).toHaveBeenCalledWith('/start/preview')
  })

  it('channels step: enables main button when at least one channel is verified', async () => {
    mockSearchParams = new URLSearchParams('step=channels')
    mockFetchRouter({
      verification: { status: 'VERIFIED', hasDocument: true },
      quickStart: {
        facts: {
          BUSINESS_KNOWLEDGE_CONFIRMED: true,
          TEXT_HARNESS_CONFIRMED: true,
          IMAGE_HARNESS_CONFIRMED: true,
          INSTAGRAM_VERIFIED: false,
          THREADS_VERIFIED: true,
        },
        profile: { business_name: '모모 카페', industry: '카페·디저트', summary: '원두' },
        ready: true,
        progressPercent: 100,
      },
    })
    render(<StartWizard />)
    expect(await screen.findByText('게시물을 올릴 계정을 연결해 주세요')).toBeInTheDocument()

    const mainBtn = screen.getByRole('button', { name: '연결 완료 · 첫 글 만들기' })
    expect(mainBtn).toBeEnabled()
    expect(screen.queryByText('아직 연결하지 않아도 첫 글은 미리 볼 수 있어요')).not.toBeInTheDocument()
    expect(screen.getByText('연결이 끝났어요. 첫 글을 확인하러 가볼까요?')).toBeInTheDocument()

    fireEvent.click(mainBtn)
    expect(routerMocks.push).toHaveBeenCalledWith('/start/preview')
  })

  it('channels step: 스텝퍼는 계정 연결을 현재 단계로, 앞 단계를 완료로 표시한다', async () => {
    mockSearchParams = new URLSearchParams('step=channels')
    mockFetchRouter({ quickStart: { facts: {} } })
    render(<StartWizard />)
    await screen.findByText('게시물을 올릴 계정을 연결해 주세요')

    const items = screen.getAllByRole('listitem').filter((li) => li.querySelector('span'))
    const current = items.filter((li) => li.getAttribute('aria-current') === 'step')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('계정 연결')
    expect(screen.getByRole('progressbar', { name: '준비 진행률' })).toHaveAttribute('aria-valuenow', '75')
  })

  it('channels step: 사업자 미인증이면 선택 카드로 안내하고 인증 화면으로 이동한다', async () => {
    mockSearchParams = new URLSearchParams('step=channels')
    mockFetchRouter({
      quickStart: { facts: { BUSINESS_VERIFIED: false } },
      verification: { status: 'NOT_STARTED', hasDocument: false, isVerified: false },
    })
    render(<StartWizard />)
    await screen.findByText('게시물을 올릴 계정을 연결해 주세요', undefined, { timeout: 5000 })

    expect(screen.getByText('사업자 인증은 나중에 해도 괜찮아요')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '지금 인증하기' }))
    expect(await screen.findByRole('heading', { name: '사업자 인증' }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText('정확한 정보를 입력하면 국세청에서 바로 확인해요.')).toBeInTheDocument()
  })

  it('channels step: 사업자 인증이 완료되어 있으면 인증 완료 카드를 보여준다', async () => {
    mockSearchParams = new URLSearchParams('step=channels')
    mockFetchRouter({ quickStart: { facts: { BUSINESS_VERIFIED: true } } })
    render(<StartWizard />)
    await screen.findByText('게시물을 올릴 계정을 연결해 주세요', undefined, { timeout: 5000 })

    expect(screen.getByText('사업자 인증 완료')).toBeInTheDocument()
    expect(screen.getByText(/인증된 사업자라서 발행 지원 혜택이 적용돼요/)).toBeInTheDocument()
    expect(screen.queryByText(/크레딧/)).not.toBeInTheDocument()
    expect(screen.queryByText(/자동 발행 한도/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '지금 인증하기' })).not.toBeInTheDocument()
  })

  it('OAuth 복귀: 쿼리(?step=channels&connect=authorized&channel=threads)를 읽어 즉시 연결됨 표시 및 첫 글 만들기 활성화', async () => {
    mockSearchParams = new URLSearchParams('step=channels&connect=authorized&channel=threads&account=test_user')
    mockFetchRouter({
      verification: { status: 'VERIFIED', hasDocument: true },
      quickStart: {
        facts: {
          BUSINESS_KNOWLEDGE_CONFIRMED: true,
          TEXT_HARNESS_CONFIRMED: true,
          IMAGE_HARNESS_CONFIRMED: true,
          INSTAGRAM_VERIFIED: false,
          THREADS_VERIFIED: false, // 서버 반영 전이어도 쿼리 기반으로 즉시 활성화
        },
        profile: { business_name: '모모 카페', industry: '카페·디저트', summary: '원두' },
        ready: false,
        progressPercent: 66,
      },
    })

    render(<StartWizard />)
    expect(await screen.findByText('게시물을 올릴 계정을 연결해 주세요')).toBeInTheDocument()

    // 스레드에 연결됨 배지 표시 확인
    expect(screen.getByText('연결됨')).toBeInTheDocument()

    // '연결 완료 · 첫 글 만들기' 버튼 즉시 활성화 확인
    const mainBtn = screen.getByRole('button', { name: '연결 완료 · 첫 글 만들기' })
    expect(mainBtn).toBeEnabled()

    // 성공 토스트 확인
    expect(toastMocks.success).toHaveBeenCalledWith('스레드(@test_user) 계정이 연결되었어요.')
  })

  it('channels step: 연결 카드 옆 도움말에 게시 권한 및 프로페셔널 계정 안내가 노출된다', async () => {
    mockSearchParams = new URLSearchParams('step=channels')
    mockFetchRouter({
      verification: { status: 'VERIFIED', hasDocument: true },
      quickStart: {
        facts: {},
        profile: { business_name: '모모 카페', industry: '카페·디저트', summary: '원두' },
        ready: false,
        progressPercent: 50,
      },
    })

    render(<StartWizard />)
    expect(await screen.findByText('게시물을 올릴 계정을 연결해 주세요')).toBeInTheDocument()

    expect(
      screen.getByText(/연결할 때 "게시물 작성" 권한까지 모두 허용해 주세요\. 인스타그램은 비즈니스 또는 크리에이터 계정이어야 해요\./),
    ).toBeInTheDocument()
  })

  it('OAuth 복귀 실패: SCOPE_MISSING 오류 발생 시 공용 안내와 [다시 연결하기] 버튼을 role=alert로 노출한다', async () => {
    mockSearchParams = new URLSearchParams('step=channels&error=SCOPE_MISSING&channel=threads')
    mockFetchRouter({
      verification: { status: 'VERIFIED', hasDocument: true },
      quickStart: {
        facts: {},
        profile: { business_name: '모모 카페', industry: '카페·디저트', summary: '원두' },
        ready: false,
        progressPercent: 50,
      },
    })

    render(<StartWizard />)
    expect(await screen.findByText('게시물을 올릴 계정을 연결해 주세요')).toBeInTheDocument()

    const alertBox = screen.getByRole('alert')
    expect(alertBox).toBeInTheDocument()
    expect(alertBox).toHaveTextContent('게시 권한을 허용해 주세요')
    expect(alertBox).toHaveTextContent(
      '소희가 사장님 대신 글을 올리려면 "게시물 작성" 권한이 필요해요. 다시 연결하면서 게시 권한을 허용해 주세요.',
    )

    const retryLink = screen.getByRole('link', { name: '다시 연결하기' })
    expect(retryLink).toHaveAttribute('href', '/api/channels/threads/connect?returnPath=%2Fstart%3Fstep%3Dchannels')
  })

  it('OAuth 복귀 실패: ACCOUNT_ALREADY_CONNECTED 오류 발생 시 공용 안내와 [다른 계정으로 연결하기] 버튼을 role=alert로 노출한다', async () => {
    mockSearchParams = new URLSearchParams('step=channels&error=ACCOUNT_ALREADY_CONNECTED&channel=instagram')
    mockFetchRouter({
      verification: { status: 'VERIFIED', hasDocument: true },
      quickStart: {
        facts: {},
        profile: { business_name: '모모 카페', industry: '카페·디저트', summary: '원두' },
        ready: false,
        progressPercent: 50,
      },
    })

    render(<StartWizard />)
    expect(await screen.findByText('게시물을 올릴 계정을 연결해 주세요')).toBeInTheDocument()

    const alertBox = screen.getByRole('alert')
    expect(alertBox).toBeInTheDocument()
    expect(alertBox).toHaveTextContent('이미 다른 소희 계정에 연결된 계정이에요')
    expect(alertBox).toHaveTextContent(
      '이 인스타그램/스레드 계정은 다른 소희 계정에서 사용 중이에요. 원래 사용하던 소희 계정으로 로그인하거나, 다른 계정으로 연결해 주세요. 도움이 필요하면 소희 운영팀에 문의해 주세요.',
    )

    const switchLink = screen.getByRole('link', { name: '다른 계정으로 연결하기' })
    expect(switchLink).toHaveAttribute('href', '/api/channels/instagram/connect?returnPath=%2Fstart%3Fstep%3Dchannels')
  })
})
