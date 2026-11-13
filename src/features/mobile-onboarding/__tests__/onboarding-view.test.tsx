// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

// 사진 업로드 카드는 자기 API 를 스스로 호출한다. 이 테스트는 화면 조립만 검증한다.
vi.mock('@/features/media/media-upload-card', () => ({
  MediaUploadCard: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="media-upload" data-workspace={workspaceId}>
      사진 선택
    </div>
  ),
}))

import {
  MobileOnboardingView,
  onboardingScreenConfig,
  resolveOnboardingView,
  type OnboardingActions,
  type OnboardingViewSnapshot,
} from '../onboarding-view'

const SHOP = { business_name: '바이름', industry: '뷰티', summary: '동네 미용실' }
const NO_FACTS = { TEXT_HARNESS_CONFIRMED: false, INSTAGRAM_VERIFIED: false, THREADS_VERIFIED: false }

function makeSnapshot(overrides: Partial<OnboardingViewSnapshot> = {}): OnboardingViewSnapshot {
  const profile = overrides.profile === undefined ? { ...SHOP } : overrides.profile
  return {
    loadState: 'ready',
    workspaceId: 'ws-1',
    profile,
    preferences: { tone: 'friendly' },
    facts: { ...NO_FACTS },
    checkedAt: '2026-10-23T05:00:00Z',
    empty: profile === null,
    ...overrides,
  }
}

function makeActions(overrides: Partial<OnboardingActions> = {}): OnboardingActions {
  return {
    saveShop: vi.fn(async () => ({ ok: true }) as const),
    saveTone: vi.fn(async () => ({ ok: true }) as const),
    goChannels: vi.fn(),
    goPreview: vi.fn(),
    reload: vi.fn(),
    ...overrides,
  }
}

describe('M03 가게 소개 화면', () => {
  it('가게 정보가 비어 있으면 1단계(가게 정보)를 입력 폼과 함께 보여준다', () => {
    const { container } = render(
      <MobileOnboardingView snapshot={makeSnapshot({ profile: null })} actions={makeActions()} />,
    )
    expect(screen.getByRole('heading', { name: '가게 정보를 알려 주세요' })).toBeTruthy()
    expect(container.querySelectorAll('input, textarea')).toHaveLength(2 + 1)
    expect(screen.getByLabelText('가게 이름')).toBeTruthy()
    expect(screen.getByLabelText('업종')).toBeTruthy()
    expect(screen.getByLabelText('한 줄 소개')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '소희가 글을 쓸 말투를 골라 주세요' })).toBeNull()
  })

  it('빈 상태(empty)는 첫 진입 안내를, 저장된 값이 있으면 일반 안내를 보여준다', () => {
    const first = render(<MobileOnboardingView snapshot={makeSnapshot({ profile: null })} actions={makeActions()} />)
    expect(screen.getByText(/아직 저장된 가게 정보가 없어요/)).toBeTruthy()
    first.unmount()

    render(
      <MobileOnboardingView
        snapshot={makeSnapshot({ profile: { ...SHOP, industry: '' } })}
        actions={makeActions()}
      />,
    )
    expect(screen.queryByText(/아직 저장된 가게 정보가 없어요/)).toBeNull()
    expect(screen.getByText(/가게 이름과 업종, 한 줄 소개가 있어야/)).toBeTruthy()
  })

  it('서버에 저장된 가게 정보를 폼에 채워 보여준다(비어 있는 칸만 다시 받는다)', () => {
    render(
      <MobileOnboardingView
        snapshot={makeSnapshot({ profile: { ...SHOP, industry: '' } })}
        actions={makeActions()}
      />,
    )
    expect((screen.getByLabelText('가게 이름') as HTMLInputElement).value).toBe('바이름')
    expect((screen.getByLabelText('업종') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('한 줄 소개') as HTMLTextAreaElement).value).toBe('동네 미용실')
  })

  it('랜딩에서 고른 업종은 서버 업종이 비었을 때만 프리필된다(사장님이 고칠 수 있는 값)', () => {
    render(
      <MobileOnboardingView
        snapshot={makeSnapshot({ profile: null })}
        actions={makeActions()}
        industryPrefill="뷰티"
      />,
    )
    expect((screen.getByLabelText('업종') as HTMLInputElement).value).toBe('뷰티')
  })

  it('서버에 저장된 업종이 있으면 프리필로 덮어쓰지 않는다', () => {
    render(
      <MobileOnboardingView
        snapshot={makeSnapshot({ profile: { business_name: '봄날', industry: '미용실', summary: '' } })}
        actions={makeActions()}
        industryPrefill="뷰티"
      />,
    )
    expect((screen.getByLabelText('업종') as HTMLInputElement).value).toBe('미용실')
  })

  it('업종만 비어 있어도 1단계로 되돌아간다', () => {
    render(
      <MobileOnboardingView
        snapshot={makeSnapshot({ profile: { ...SHOP, industry: '   ' } })}
        actions={makeActions()}
      />,
    )
    expect(screen.getByRole('heading', { name: '가게 정보를 알려 주세요' })).toBeTruthy()
  })

  it('가게 정보가 모두 있으면 2단계(말투)를 보여준다', () => {
    render(<MobileOnboardingView snapshot={makeSnapshot()} actions={makeActions()} />)
    expect(screen.getByRole('heading', { name: '소희가 글을 쓸 말투를 골라 주세요' })).toBeTruthy()
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(1)
  })

  it('말투가 확정되고 채널이 없으면 3단계(계정 연결)를 보여준다', () => {
    render(
      <MobileOnboardingView
        snapshot={makeSnapshot({ facts: { ...NO_FACTS, TEXT_HARNESS_CONFIRMED: true } })}
        actions={makeActions()}
      />,
    )
    expect(screen.getByRole('heading', { name: '글을 올릴 계정을 연결해 주세요' })).toBeTruthy()
    expect(screen.getAllByText('아직 연결되지 않았어요')).toHaveLength(2)
  })

  it('채널 하나만 연결되어도 4단계(첫 글 미리보기)로 넘어간다', () => {
    render(
      <MobileOnboardingView
        snapshot={makeSnapshot({
          facts: { TEXT_HARNESS_CONFIRMED: true, INSTAGRAM_VERIFIED: true, THREADS_VERIFIED: false },
        })}
        actions={makeActions()}
      />,
    )
    expect(screen.getByRole('heading', { name: '다음은 첫 글 미리보기예요' })).toBeTruthy()
    expect(screen.getByText(/올리기 전에 사장님이 확인하고 결정해요/)).toBeTruthy()
  })

  it('사진 선택 영역은 서버가 확인한 workspace 로 붙는다', () => {
    render(<MobileOnboardingView snapshot={makeSnapshot({ profile: null })} actions={makeActions()} />)
    expect(screen.getByTestId('media-upload').getAttribute('data-workspace')).toBe('ws-1')
  })

  it('workspace 를 확인하지 못했으면 사진 업로드를 열지 않고 이유를 알린다', () => {
    render(
      <MobileOnboardingView snapshot={makeSnapshot({ profile: null, workspaceId: null })} actions={makeActions()} />,
    )
    expect(screen.queryByTestId('media-upload')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('사진을 올리려면')
  })

  it('조회 실패면 단계를 그리지 않고 실패를 알린다', () => {
    const { container } = render(
      <MobileOnboardingView snapshot={makeSnapshot({ loadState: 'error', profile: null })} actions={makeActions()} />,
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(container.textContent).not.toContain('가게 정보를 알려 주세요')
  })

  it('형식을 확인할 수 없는 응답(unknown)도 빈 화면이 아니라 실패로 다룬다', () => {
    render(<MobileOnboardingView snapshot={makeSnapshot({ loadState: 'unknown' })} actions={makeActions()} />)
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('조회 실패 화면의 다음 행동은 다시 확인이다', () => {
    const actions = makeActions()
    render(<MobileOnboardingView snapshot={makeSnapshot({ loadState: 'error' })} actions={actions} />)
    fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))
    expect(actions.reload).toHaveBeenCalledTimes(1)
  })

  it('불러오는 중에는 스켈레톤만 그리고 단계를 그리지 않는다', () => {
    const { container } = render(
      <MobileOnboardingView snapshot={makeSnapshot({ loadState: 'loading' })} actions={makeActions()} />,
    )
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('이전에 확인한 내용이면 배너·단계 내용과 함께 다시 확인 동작을 제공한다', () => {
    const actions = makeActions()
    render(<MobileOnboardingView snapshot={makeSnapshot({ loadState: 'stale' })} actions={actions} />)
    expect(screen.getByText('이전에 확인한 내용이에요')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: '가게 소개 단계' })).toBeTruthy()
    // stale 에서 내용을 유지한 채 최신 상태를 다시 확인할 수 있어야 한다(막다른 화면 금지).
    fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))
    expect(actions.reload).toHaveBeenCalledTimes(1)
  })

  it('현재 단계는 aria-current 로 표시하고 완료 단계는 완료로 표시한다', () => {
    const { container } = render(
      <MobileOnboardingView
        snapshot={makeSnapshot({ facts: { ...NO_FACTS, TEXT_HARNESS_CONFIRMED: true } })}
        actions={makeActions()}
      />,
    )
    const current = container.querySelector('[aria-current="step"]')
    expect(current?.textContent).toContain('계정')
    expect(current?.textContent).toContain('지금')
    expect(container.textContent).toContain('완료')
  })

  it('내부 상태 코드를 사장님 화면에 노출하지 않는다', () => {
    const { container } = render(
      <MobileOnboardingView snapshot={makeSnapshot({ loadState: 'error' })} actions={makeActions()} />,
    )
    expect(container.textContent).not.toContain('error')
    expect(container.textContent).not.toContain('partial')
    expect(container.textContent).not.toContain('stale')
  })

  it('가게 소개 화면은 DETAIL 모드 단일 화면 계약을 따른다', () => {
    const config = onboardingScreenConfig()
    expect(config.mode).toBe('DETAIL')
    expect(config.title).toBe('가게 소개')
  })
})

describe('가게 정보 저장', () => {
  it('세 칸을 채우면 저장 버튼이 열리고, 앞뒤 공백을 지워 저장한다', async () => {
    const actions = makeActions()
    render(<MobileOnboardingView snapshot={makeSnapshot({ profile: null })} actions={actions} />)

    const submit = screen.getByRole('button', { name: '저장하고 다음' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('가게 이름'), { target: { value: '  봄날  ' } })
    fireEvent.change(screen.getByLabelText('업종'), { target: { value: '카페·디저트 ' } })
    fireEvent.change(screen.getByLabelText('한 줄 소개'), { target: { value: ' 동네 카페 ' } })
    expect(submit.disabled).toBe(false)

    fireEvent.click(submit)
    await waitFor(() =>
      expect(actions.saveShop).toHaveBeenCalledWith({
        businessName: '봄날',
        industry: '카페·디저트',
        summary: '동네 카페',
      }),
    )
    expect(await screen.findByRole('heading', { name: '소희가 글을 쓸 말투를 골라 주세요' })).toBeTruthy()
  })

  it('저장에 실패하면 서버가 준 문구를 보여주고 단계를 넘기지 않는다', async () => {
    const actions = makeActions({
      saveShop: vi.fn(async () => ({ ok: false, message: '입력한 내용을 저장하지 못했어요.' }) as const),
    })
    render(<MobileOnboardingView snapshot={makeSnapshot({ profile: null })} actions={actions} />)

    fireEvent.change(screen.getByLabelText('가게 이름'), { target: { value: '봄날' } })
    fireEvent.change(screen.getByLabelText('업종'), { target: { value: '카페' } })
    fireEvent.change(screen.getByLabelText('한 줄 소개'), { target: { value: '동네 카페' } })
    fireEvent.click(screen.getByRole('button', { name: '저장하고 다음' }))

    expect(await screen.findByText('입력한 내용을 저장하지 못했어요.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '가게 정보를 알려 주세요' })).toBeTruthy()
  })

  it('말투를 고르면 기존 저장 명령으로 그 값을 넘긴다', async () => {
    const actions = makeActions()
    render(<MobileOnboardingView snapshot={makeSnapshot()} actions={actions} />)

    fireEvent.click(screen.getAllByRole('radio')[1])
    fireEvent.click(screen.getByRole('button', { name: '이 말투로 정하고 다음' }))
    await waitFor(() => expect(actions.saveTone).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('heading', { name: '글을 올릴 계정을 연결해 주세요' })).toBeTruthy()
  })
})

describe('resolveOnboardingView', () => {
  it('가게 정보가 비면 ready + 1단계다', () => {
    const { kind, progress } = resolveOnboardingView(makeSnapshot({ profile: null }))
    expect(kind).toBe('ready')
    expect(progress.step).toBe('shop')
  })

  it('조회 실패는 error 다', () => {
    expect(resolveOnboardingView(makeSnapshot({ loadState: 'error' })).kind).toBe('error')
  })

  it('unknown 도 error 다', () => {
    expect(resolveOnboardingView(makeSnapshot({ loadState: 'unknown' })).kind).toBe('error')
  })

  it('stale 은 내용을 유지한 채 stale 로 알린다', () => {
    expect(resolveOnboardingView(makeSnapshot({ loadState: 'stale' })).kind).toBe('stale')
  })

  it.each([
    ['loading', 'loading'],
    ['ready', 'ready'],
    ['stale', 'stale'],
    ['error', 'error'],
    ['unknown', 'error'],
  ] as const)('loadState %s 는 화면 kind %s 로 매핑된다', (loadState, kind) => {
    expect(resolveOnboardingView(makeSnapshot({ loadState })).kind).toBe(kind)
  })
})
