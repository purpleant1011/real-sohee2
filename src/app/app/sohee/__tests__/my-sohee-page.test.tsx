import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import MySoheePage from '../[[...tab]]/page'
import { PROPOSAL_APPLIED_EVENT } from '@/features/agent-dock/proposal-bus'
import type { ProposalPayload } from '@/features/agent-dock/types'
import { buildGrowthSnapshot } from '@/features/sohee-growth/snapshot'
import { PARTIAL } from '@/features/sohee-growth/__tests__/fixtures'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/sohee',
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

vi.mock('next/image', () => ({
  default: (props: any) => <img {...props} alt={props.alt || ''} />,
}))

vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', resolvedTheme: 'light', setTheme: vi.fn() }),
}))

vi.mock('@/hooks/use-credit-balance', () => ({
  useCreditBalance: () => ({
    balance: 5000,
    capacity: 5000,
    remainingPercentage: 100,
  }),
}))

vi.mock('@/hooks/use-sohee-autonomy', () => ({
  useSoheeAutonomy: () => ({
    isRunning: true,
    actualMode: 'RUNNING',
    killSwitchActive: false,
    isLoading: false,
    setAutonomy: vi.fn(),
  }),
}))

vi.mock('@/hooks/use-workspace-context', () => ({
  useWorkspaceId: () => '11111111-1111-4111-8111-111111111111',
  useWorkspaceContext: () => ({
    workspaceId: '11111111-1111-4111-8111-111111111111',
    workspaceName: '바이름 청라점',
    workspaceKind: 'standard',
    membershipRole: 'owner',
    actorId: 'u-1',
    resolutionSource: 'membership',
  }),
  useOptionalWorkspaceContext: () => ({
    workspaceId: '11111111-1111-4111-8111-111111111111',
    workspaceName: '바이름 청라점',
    workspaceKind: 'standard',
    membershipRole: 'owner',
    actorId: 'u-1',
    resolutionSource: 'membership',
  }),
}))

const createQueryBuilder = () => {
  const qb: any = {
    select: () => qb,
    eq: () => qb,
    in: () => qb,
    limit: () => qb,
    maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    single: vi.fn().mockResolvedValue({ data: null }),
    upsert: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn().mockResolvedValue({ error: null }),
    then: (resolve: any) => Promise.resolve({ data: [{ id: 'biz-1', business_name: '바이름 청라점' }] }).then(resolve),
  }
  return qb
}

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: 'u-1',
            email: 'test@example.com',
            user_metadata: { full_name: '바이름 원장님' },
          },
        },
      }),
    },
    from: () => createQueryBuilder(),
  }),
}))

vi.mock('@/features/agent-dock/surface-context', () => ({
  SurfaceContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSurfaceContext: () => ({
    surface: 'sohee',
    contextDetails: {},
    setContextDetails: vi.fn(),
  }),
}))

// Heavy child components stubs
vi.mock('@/components/v088/sohee/autonomy-envelope-card', () => ({
  AutonomyEnvelopeCard: () => <div>AutonomyEnvelopeCard</div>,
}))

vi.mock('@/components/v088/harness/harness-library-view', () => ({
  HarnessLibraryView: () => <div>HarnessLibraryView</div>,
}))

vi.mock('@/components/v088/harness/harness-detail-view', () => ({
  HarnessDetailView: () => <div>HarnessDetailView</div>,
}))

vi.mock('@/components/v088/harness/harness-create-modal', () => ({
  HarnessCreateModal: () => <div>HarnessCreateModal</div>,
}))

vi.mock('@/features/campaigns/CampaignBrainWorkspace', () => ({
  CampaignBrainWorkspace: () => <div>CampaignBrainWorkspace</div>,
}))

vi.mock('@/features/automation/automation-workspace', () => ({
  AutomationWorkspace: () => <div>AutomationWorkspace</div>,
}))

vi.mock('@/components/v088/command/sohee-judgment', () => ({
  SoheeJudgment: () => <div>SoheeJudgment</div>,
}))

vi.mock('@/features/attribution/AttributionOutcomeConsole', () => ({
  AttributionOutcomeConsole: () => <div>AttributionOutcomeConsole</div>,
}))

vi.mock('@/components/v088/agent-studio/cloud-browser-auth-card', () => ({
  CloudBrowserAuthCard: () => <div>CloudBrowserAuthCard</div>,
}))

vi.mock('@/features/plugins/PluginMarketplaceView', () => ({
  PluginMarketplaceView: () => <div>PluginMarketplaceView</div>,
}))

describe('MySoheePage Renewal Structure', () => {
  const mockSnapshot = buildGrowthSnapshot(PARTIAL)
  let fetchGrowthFail = false
  let soheeGrowthCallCount = 0
  let postProfileBody: any = null

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.setItem('sohee_onboarded', 'true')
    window.history.pushState(null, '', '/app/sohee')
    fetchGrowthFail = false
    soheeGrowthCallCount = 0
    postProfileBody = null

    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      if (url.includes('/sohee-studio/overview')) {
        if (fetchGrowthFail) {
          return Promise.resolve({
            ok: false,
            status: 500,
            json: async () => ({ success: false, error: 'SERVER_ERROR' }),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              workspaceId: '11111111-1111-4111-8111-111111111111',
              knowledgeStats: { activeCount: 5, pendingProposalCount: 0, staleCount: 0, byCategory: {} },
              topQuestions: [],
              activeGoals: [],
              educationReadiness: 42,
            },
          }),
        })
      }
      if (url.includes('/sohee-studio/knowledge')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        })
      }
      if (url.includes('/sohee-studio/turns')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        })
      }
      if (url.includes('/sohee-growth')) {
        soheeGrowthCallCount++
        if (fetchGrowthFail) {
          return Promise.resolve({
            ok: false,
            status: 500,
            json: async () => ({ success: false, error: 'SERVER_ERROR' }),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: mockSnapshot }),
        })
      }
      if (url.includes('/profile')) {
        if (init?.method === 'POST') {
          postProfileBody = JSON.parse(init.body)
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ success: true }),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            profile: {
              business: {
                business_name: '바이름 청라점',
                industry: '미용',
                location: '인천 청라',
                summary: '정성스런 1:1 케어',
              },
              brand: {
                voice: '다정한 말투',
                keywords: ['헤어', '청라'],
                prohibited_terms: ['100% 보장'],
              },
            },
          }),
        })
      }
      if (url.includes('/agent/workboard')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: {} }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      })
    }) as any
  })

  it('1. 4개 탭이 보인다: 소희 스튜디오, 일하는 방식 & 정책, 능력 확장, 매장 기본 정보', async () => {
    render(<MySoheePage />)
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /소희 스튜디오/ })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /일하는 방식 & 정책/ })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /능력 확장/ })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /매장 기본 정보/ })).toBeInTheDocument()
    })
    expect(screen.queryByText(/1\. 소희에게 가르치기/)).not.toBeInTheDocument()
    expect(screen.queryByText(/돈 · 할인 권한/)).not.toBeInTheDocument()
    expect(screen.queryByText(/소희 사원 관리 & 지침/)).not.toBeInTheDocument()
    expect(screen.queryByText(/준비센터/)).not.toBeInTheDocument()
    expect(screen.queryByText(/온보딩 퀘스트/)).not.toBeInTheDocument()
  })

  it('2. 기본 스튜디오 화면: 소희가 이해한 우리 매장 헤더 및 교육 준비도 42%가 보인다', async () => {
    render(<MySoheePage />)
    await waitFor(() => {
      expect(screen.getByText('소희가 이해한 우리 매장')).toBeInTheDocument()
      expect(screen.getByText(/교육 준비도 42%/)).toBeInTheDocument()
    })
  })

  it('3. 스튜디오 뇌 관제 탭: 지식, 궁금해요, 목표, 성장 서브 탭들이 보인다', async () => {
    render(<MySoheePage />)
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /지식/ })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /궁금해요/ })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /목표/ })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /성장/ })).toBeInTheDocument()
    })
  })

  it('4. 로딩·오류: 스냅샷 실패 시 에러가 스튜디오 뷰에 반영되고 다시 시도할 수 있다', async () => {
    fetchGrowthFail = true
    render(<MySoheePage />)
    await waitFor(() => {
      expect(screen.getByText(/두뇌 현황 데이터를 불러오지 못했습니다/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /다시 시도/ })).toBeInTheDocument()
    })

    // 다시 시도 클릭 시 성공으로 복구
    fetchGrowthFail = false
    fireEvent.click(screen.getByRole('button', { name: /다시 시도/ }))
    await waitFor(() => {
      expect(screen.getByText(/교육 준비도 42%/)).toBeInTheDocument()
    })
  })

  it('5. 탭 전환: 일하는 방식 클릭 -> 말투 구역, 능력 확장 클릭 -> 소희가 쓸 수 있는 기능', async () => {
    render(<MySoheePage />)
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /일하는 방식 & 정책/ })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('tab', { name: /일하는 방식 & 정책/ }))
    await waitFor(() => {
      expect(screen.getByText('말투')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('tab', { name: /능력 확장/ }))
    await waitFor(() => {
      expect(screen.getByText('소희가 쓸 수 있는 기능')).toBeInTheDocument()
    })
  })

  it('6. 옛 쿼리 호환: ?tab=rules -> 일하는 방식(바로 해요), ?tab=campaigns -> 캠페인 열림, ?tab=capabilities / ?tab=channels -> 능력 확장, ?tab=profile / ?tab=knowledge -> 가르치기', async () => {
    // ?tab=rules
    window.history.pushState(null, '', '/app/sohee?tab=rules')
    const { unmount: u1 } = render(<MySoheePage />)
    await waitFor(() => {
      expect(screen.getByText('바로 해요')).toBeInTheDocument()
    })
    u1()

    // ?tab=campaigns
    window.history.pushState(null, '', '/app/sohee?tab=campaigns')
    const { unmount: u2 } = render(<MySoheePage />)
    await waitFor(() => {
      const details = document.getElementById('campaigns') as HTMLDetailsElement
      expect(details).toBeInTheDocument()
      expect(details.open).toBe(true)
    })
    u2()

    // ?tab=capabilities
    window.history.pushState(null, '', '/app/sohee?tab=capabilities')
    const { unmount: u3 } = render(<MySoheePage />)
    await waitFor(() => {
      expect(screen.getByText('소희가 쓸 수 있는 기능')).toBeInTheDocument()
    })
    u3()

    // ?tab=channels
    window.history.pushState(null, '', '/app/sohee?tab=channels')
    const { unmount: u4 } = render(<MySoheePage />)
    await waitFor(() => {
      expect(screen.queryByText('CloudBrowserAuthCard')).not.toBeInTheDocument()
      expect(screen.getByText('소희가 쓸 수 있는 기능')).toBeInTheDocument()
    })
    u4()

    // ?tab=profile
    window.history.pushState(null, '', '/app/sohee?tab=profile')
    const { unmount: u5 } = render(<MySoheePage />)
    await waitFor(() => {
      expect(screen.getByText('우리 가게 정보')).toBeInTheDocument()
    })
    u5()
  })

  it('7. 매장 기본 정보 탭 이동: 클릭 시 가게 정보 폼 및 자료함이 노출된다', async () => {
    render(<MySoheePage />)
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /매장 기본 정보/ })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('tab', { name: /매장 기본 정보/ }))
    await waitFor(() => {
      expect(screen.getByText('우리 가게 정보')).toBeInTheDocument()
    })
  })

  it('8. 프로필 저장: 매장 기본 정보 탭에서 가게 소개 입력 후 저장하기 누르면 POST /profile 호출 및 스냅샷 재조회', async () => {
    render(<MySoheePage />)
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /매장 기본 정보/ })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('tab', { name: /매장 기본 정보/ }))
    await waitFor(() => {
      expect(screen.getByLabelText('가게 소개와 강점')).toBeInTheDocument()
    })

    const summaryInput = screen.getByLabelText('가게 소개와 강점')
    fireEvent.change(summaryInput, { target: { value: '새로운 우리 가게 소개글' } })

    const initialCallCount = soheeGrowthCallCount
    fireEvent.click(screen.getByRole('button', { name: '저장하기' }))

    await waitFor(() => {
      expect(postProfileBody).not.toBeNull()
      expect(postProfileBody.business.summary).toBe('새로운 우리 가게 소개글')
      expect(soheeGrowthCallCount).toBeGreaterThan(initialCallCount)
    })
  })

  it('9. 제안 동기화: PROPOSAL_APPLIED_EVENT 로 금지어 제안이 오면 동기화 알림이 보이고 금지어 입력에 값이 더해진다', async () => {
    render(<MySoheePage />)
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /매장 기본 정보/ })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('tab', { name: /매장 기본 정보/ }))
    await waitFor(() => {
      expect(screen.getByText('우리 가게 정보')).toBeInTheDocument()
    })

    const testProposal: ProposalPayload = {
      id: 'prop-prohibited-1',
      type: 'RULE_UPDATE',
      title: '금지어 추가 지침',
      description: '과장 광고 방지 단어 추가',
      targetField: 'prohibitedTerms',
      proposedValue: '무통증 보장',
      status: 'ACCEPTED',
      createdAt: new Date().toISOString(),
    }

    act(() => {
      window.dispatchEvent(new CustomEvent(PROPOSAL_APPLIED_EVENT, { detail: testProposal }))
    })

    await waitFor(() => {
      expect(screen.getByText(/동기화 완료/)).toBeInTheDocument()
    })

    // 일하는 방식 탭으로 이동해서 금지어 확인
    fireEvent.click(screen.getByRole('tab', { name: /일하는 방식 & 정책/ }))
    await waitFor(() => {
      const prohibitedInput = screen.getByLabelText(/쓰지 말아야 할 표현/) as HTMLInputElement
      expect(prohibitedInput.value).toContain('무통증 보장')
    })
  })

  it('10. 내부 용어 없음: Direct Edit, Autonomy Envelope, Canonical, SSOT, R0, R1, R2, 하네스가 없다', async () => {
    render(<MySoheePage />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '소희 스튜디오' })).toBeInTheDocument()
    })

    const bodyText = document.body.textContent || ''
    expect(bodyText).not.toMatch(/Direct Edit/)
    expect(bodyText).not.toMatch(/Autonomy Envelope/)
    expect(bodyText).not.toMatch(/Canonical/)
    expect(bodyText).not.toMatch(/SSOT/)
    expect(bodyText).not.toMatch(/\bR0\b/)
    expect(bodyText).not.toMatch(/\bR1\b/)
    expect(bodyText).not.toMatch(/\bR2\b/)
    expect(bodyText).not.toMatch(/하네스/)
  })
})
