import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TeachTab } from '../components/teach-tab'
import { WorkTab } from '../components/work-tab'
import { ToolsTab } from '../components/tools-tab'
import { buildGrowthSnapshot } from '@/features/sohee-growth/snapshot'
import { PARTIAL } from '@/features/sohee-growth/__tests__/fixtures'

vi.mock('../components/interview-engine', () => ({
  InterviewEngine: ({ onFactConfirmed }: { onFactConfirmed: () => void }) => (
    <button onClick={onFactConfirmed}>InterviewEngine</button>
  ),
}))

vi.mock('../components/materials-box', () => ({
  MaterialsBox: ({ onMaterialUpdated }: { onMaterialUpdated: () => void }) => (
    <button onClick={onMaterialUpdated}>MaterialsBox</button>
  ),
}))

vi.mock('../components/knowledge-simulator', () => ({
  KnowledgeSimulator: () => <div>KnowledgeSimulator</div>,
}))

vi.mock('../components/knowledge-library', () => ({
  KnowledgeLibrary: ({ onKnowledgeChanged }: { onKnowledgeChanged: () => void }) => (
    <button onClick={onKnowledgeChanged}>KnowledgeLibrary</button>
  ),
}))

vi.mock('@/features/knowledge/naver-place/naver-place-connect-card', () => ({
  NaverPlaceConnectCard: ({ onPlaceSynced }: { onPlaceSynced?: (summary: any) => void }) => (
    <button
      onClick={() =>
        onPlaceSynced?.({
          name: '플레이스 식당',
          category: '한식',
          roadAddress: '서울시 강남구 테헤란로 123',
        })
      }
    >
      NaverPlaceConnectCard
    </button>
  ),
}))

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

describe('Sohee 3-Tab Components', () => {
  const createMockForm = (overrides = {}) => ({
    values: {
      businessName: '',
      industry: '',
      location: '',
      summary: '',
      voice: '',
      keywords: '',
      prohibitedTerms: '',
      ...overrides,
    },
    setField: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    status: {
      isSaving: false,
      saveSuccess: false,
      saveError: null,
      persistenceState: 'READBACK_VERIFIED' as const,
      proposalAlert: null,
    },
  })

  it('renders TeachTab with KnownBusinessCard, NaverPlaceConnectCard, profile form, and info card, with summary empty', () => {
    const snapshot = buildGrowthSnapshot(PARTIAL)
    const form = createMockForm()

    const onRefresh = vi.fn()

    render(<TeachTab snapshot={snapshot} form={form as any} workspaceId="ws-test" onRefresh={onRefresh} />)

    expect(screen.getByText('소희가 아는 우리 가게')).toBeInTheDocument()
    expect(screen.getByText('NaverPlaceConnectCard')).toBeInTheDocument()
    expect(screen.getByText('우리 가게 정보')).toBeInTheDocument()
    expect(screen.getByText('KnowledgeSimulator')).toBeInTheDocument()
    expect(screen.getByText('KnowledgeLibrary')).toBeInTheDocument()

    fireEvent.click(screen.getByText('InterviewEngine'))
    fireEvent.click(screen.getByText('MaterialsBox'))
    fireEvent.click(screen.getByText('KnowledgeLibrary'))
    expect(onRefresh).toHaveBeenCalledTimes(3)

    // NaverPlaceConnectCard 연동 클릭 시 폼 필드 반영 및 onRefresh 실행 검증
    fireEvent.click(screen.getByText('NaverPlaceConnectCard'))
    expect(form.setField).toHaveBeenCalledWith('businessName', '플레이스 식당')
    expect(form.setField).toHaveBeenCalledWith('industry', '한식')
    expect(form.setField).toHaveBeenCalledWith('location', '서울시 강남구 테헤란로 123')
    expect(onRefresh).toHaveBeenCalledTimes(4)

    const summaryInput = screen.getByLabelText('가게 소개와 강점') as HTMLTextAreaElement
    expect(summaryInput.value).toBe('')
  })

  it('renders WorkTab with voice, caution, autonomy, 3-tier rules, and opens campaigns details when openSection="campaigns"', () => {
    const form = createMockForm()

    render(<WorkTab workspaceId="ws-test" form={form as any} openSection="campaigns" />)

    expect(screen.getByText('말투')).toBeInTheDocument()
    expect(screen.getByText('조심할 표현')).toBeInTheDocument()
    expect(screen.getByText('혼자 해도 되는 범위')).toBeInTheDocument()
    expect(screen.getByText('바로 해요')).toBeInTheDocument()
    expect(screen.getByText('물어보고 해요')).toBeInTheDocument()
    expect(screen.getByText('하지 않아요')).toBeInTheDocument()

    const campaignsDetails = document.getElementById('campaigns') as HTMLDetailsElement
    expect(campaignsDetails).toBeInTheDocument()
    expect(campaignsDetails.open).toBe(true)
  })

  it('renders ToolsTab without CloudBrowserAuthCard, with plugin marketplace, and mapped action items with Korean labels', () => {
    render(<ToolsTab workspaceId="ws-test" industry="카페" businessName="모모 카페" />)

    expect(screen.queryByText('CloudBrowserAuthCard')).not.toBeInTheDocument()
    expect(screen.getByText('PluginMarketplaceView')).toBeInTheDocument()
    expect(screen.getByText('소희가 쓸 수 있는 기능')).toBeInTheDocument()

    expect(screen.getAllByText('바로 해요').length).toBeGreaterThan(0)
    expect(screen.queryByText('R0')).not.toBeInTheDocument()
    expect(screen.queryByText('R1')).not.toBeInTheDocument()
    expect(screen.queryByText('R2')).not.toBeInTheDocument()
    expect(screen.queryByText('UNKNOWN_TIER')).not.toBeInTheDocument()
  })
})
