import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import WorkspaceDetail, { sectionProblem } from './workspace-detail'
import type { OperatorWorkspaceDetailReads } from './detail-read-orchestrator'

const summary = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  workspaceName: 'Workspace A',
  timezone: 'Asia/Seoul',
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
  workspaceKind: 'production' as const,
  lifecycleStatus: 'active' as const,
  businessName: 'Business A',
  agreementStatus: 'accepted' as const,
  planCode: 'GROWTH_PLUS',
  memberCount: 2,
  availableCredits: 6000,
  instagramStatus: 'connected',
  threadsStatus: 'expired',
  publishedThisMonth: 12,
  failedThisMonth: 1,
  lastActivityAt: null,
  dataFreshness: 'fresh' as const,
  memberStatus: 'FORMAL' as const,
  memberAggregates: [],
  channels: [],
}

const mockReads: OperatorWorkspaceDetailReads = {
  lifecycle: { kind: 'empty', data: [] },
  channels: { kind: 'empty', data: [] },
  publishing: { kind: 'empty', data: { items: [], nextCursor: null } as never },
  billing: { kind: 'empty', data: { items: [], summary: {} } as never },
  creditConsumptions: { kind: 'empty', data: [] },
  support: { kind: 'empty', data: [] },
  audit: { kind: 'empty', data: { items: [], nextCursor: null } },
  knowledge: {
    kind: 'ready',
    data: {
      placeUrl: 'https://naver.me/5xgJJEBa',
      placeStatus: 'connected',
      businessName: '바이름 청라점',
      industry: '미용·네일·뷰티',
      location: '인천광역시 서구 청라라임로',
      summary: '바이름 청라점은 1:1 맞춤 예약제 매장입니다.',
      updatedAt: '2026-08-23T00:00:00.000Z',
    },
  },
}

describe('WorkspaceDetail', () => {
  it('renders real header values in Korean without the full id or fake figures', () => {
    const { container } = render(<WorkspaceDetail summary={summary} />)
    expect(screen.getByRole('heading', { name: 'Workspace A' })).toBeVisible()
    expect(screen.getAllByText('그로스 플러스').length).toBeGreaterThan(0)
    expect(screen.getAllByText('운영 중').length).toBeGreaterThan(0)
    expect(screen.getByText(/참조번호 11111111/u)).toBeVisible()
    expect(container.textContent).not.toContain(summary.workspaceId)
    expect(container.textContent).not.toMatch(/34,650|4 \/ 4|@byreum|GUARDED_AUTO|Healthy|pub-901|성공률 100%/u)
  })

  it('never renders an unread section as ready data', () => {
    render(<WorkspaceDetail summary={{ ...summary, availableCredits: null }} reads={undefined} />)
    expect(screen.getAllByText('확인할 수 없어요').length).toBeGreaterThan(0)
    expect(sectionProblem(undefined)).not.toBeNull()
    expect(sectionProblem({ kind: 'unavailable', message: 'x' })).toContain('불러오지 못했어요')
    expect(sectionProblem({ kind: 'forbidden', message: 'x' })).toContain('권한')
    expect(sectionProblem({ kind: 'ready', data: [] } as never)).toBeNull()
  })

  it('renders recent credit consumptions table under billing tab', () => {
    const reads = {
      lifecycle: { kind: 'ready' as const, data: [] },
      channels: { kind: 'ready' as const, data: [] },
      publishing: { kind: 'empty' as const, data: { items: [], nextCursor: null } },
      billing: {
        kind: 'ready' as const,
        data: {
          items: [{
            workspace_id: summary.workspaceId,
            company_name: 'Workspace A',
            entitlement: { plan_code: 'GROWTH_PLUS', weekly_limit: 10000 },
            balance: { available: 5000, consumed: 5000 },
            cost: { api_cost_krw: 12000 },
          }],
          summary: { state: 'fresh' as const, workspaceCount: 1, sourceTimestamp: '2026-08-23T00:00:00.000Z' },
        },
      },
      creditConsumptions: {
        kind: 'ready' as const,
        data: [{
          id: 'cons-1',
          referenceId: 'cons1000',
          occurredAt: '2026. 10. 10. 15:00',
          action: '인스타그램 글 생성',
          amount: -100,
          amountLabel: '-100 크레딧',
          idempotencyKey: 'idem-cons-1',
          idempotencyReference: 'idem1000',
        }],
      },
      support: { kind: 'not_connected' as const, message: '지원 기록 연결 전' as const, data: null },
      audit: { kind: 'empty' as const, data: { items: [], nextCursor: null } },
      knowledge: { kind: 'empty' as const, data: null },
    }

    render(<WorkspaceDetail summary={summary} reads={reads as any} />)
    const billingTab = screen.getByRole('tab', { name: '크레딧·결제' })
    fireEvent.click(billingTab)

    expect(screen.getByText('최근 에이전트 크레딧 차감 내역 (최근 50건)')).toBeInTheDocument()
    expect(screen.getByText('인스타그램 글 생성')).toBeInTheDocument()
    expect(screen.getByText('-100 크레딧')).toBeInTheDocument()
    expect(screen.getByText('idem1000')).toBeInTheDocument()
  })

  it('renders smartplace connection and store knowledge in knowledge tab', () => {
    render(<WorkspaceDetail summary={summary} reads={mockReads} />)
    const tabTrigger = screen.getByRole('tab', { name: '매장 지식·플레이스' })
    expect(tabTrigger).toBeVisible()
    fireEvent.click(tabTrigger)

    expect(screen.getByText('네이버 스마트플레이스 직접 등록 상태')).toBeVisible()
    expect(screen.getByText('https://naver.me/5xgJJEBa')).toBeVisible()
    expect(screen.getAllByText('직접 등록').length).toBeGreaterThan(0)
    expect(screen.getByText('바이름 청라점')).toBeVisible()
    expect(screen.getByText('미용·네일·뷰티')).toBeVisible()
    expect(screen.getByText('인천광역시 서구 청라라임로')).toBeVisible()
    expect(screen.getByText('바이름 청라점은 1:1 맞춤 예약제 매장입니다.')).toBeVisible()
  })

  it('renders knowledge readiness card when readiness stats exist', () => {
    const readinessReads: OperatorWorkspaceDetailReads = {
      ...mockReads,
      knowledge: {
        kind: 'ready',
        data: {
          placeUrl: null,
          placeStatus: null,
          businessName: '해드림물류',
          industry: '물류·운송',
          location: '서울',
          summary: '안전한 배송',
          updatedAt: '2026-10-20T00:00:00.000Z',
          readiness: {
            factsConfirmedCount: 5,
            factsPendingCount: 2,
            materialsExtractedCount: 4,
            materialsProcessingCount: 1,
            materialsFailedCount: 0,
            materialsTotalCount: 5,
            structuredFactsCount: 8,
            productsServicesStatus: 'not_supported',
            telemetry: 'not_collected',
            lastUpdatedAt: '2026-10-20T12:00:00.000Z',
          },
        },
      },
    }
    render(<WorkspaceDetail summary={summary} reads={readinessReads} />)
    const tabTrigger = screen.getByRole('tab', { name: '매장 지식·플레이스' })
    fireEvent.click(tabTrigger)

    expect(screen.getByText('지식 준비 현황')).toBeVisible()
    expect(screen.getAllByText('사용 중인 지식').length).toBeGreaterThan(0)
    expect(screen.getByText('텔레메트리: 수집하지 않음')).toBeVisible()
    expect(screen.getByText('5건')).toBeVisible()
    expect(screen.getByText('2건')).toBeVisible()
    expect(screen.getByText('4건 완료')).toBeVisible()
    expect(screen.getByText('8건')).toBeVisible()
    expect(screen.getByText('구조화 카탈로그: 집계 미지원')).toBeVisible()
    expect(screen.getByText('원문 지식과 대화 내용은 고객 프라이버시 보호를 위해 집계 수치만 제공해요.')).toBeVisible()
  })

  it('renders confirmation of error/unavailable state when readiness query fails', () => {
    const errorReadinessReads: OperatorWorkspaceDetailReads = {
      ...mockReads,
      knowledge: {
        kind: 'ready',
        data: {
          placeUrl: null,
          placeStatus: null,
          businessName: '해드림물류',
          industry: null,
          location: null,
          summary: null,
          updatedAt: null,
          readiness: {
            factsConfirmedCount: null,
            factsPendingCount: null,
            materialsExtractedCount: null,
            materialsProcessingCount: null,
            materialsFailedCount: null,
            materialsTotalCount: null,
            structuredFactsCount: null,
            productsServicesStatus: 'not_supported',
            telemetry: 'not_collected',
            lastUpdatedAt: null,
            errors: ['knowledge_facts query failed'],
          },
        },
      },
    }
    render(<WorkspaceDetail summary={summary} reads={errorReadinessReads} />)
    const tabTrigger = screen.getByRole('tab', { name: '매장 지식·플레이스' })
    fireEvent.click(tabTrigger)

    expect(screen.getAllByText('확인 불가').length).toBeGreaterThanOrEqual(4)
    expect(screen.getByText('일부 지식 지표를 조회하지 못했어요. (확인 불가 항목 참조)')).toBeVisible()
  })

  it('shows empty notice when knowledge data is empty', () => {
    const emptyReads: OperatorWorkspaceDetailReads = {
      ...mockReads,
      knowledge: {
        kind: 'empty',
        data: {
          placeUrl: null,
          placeStatus: null,
          businessName: null,
          industry: null,
          location: null,
          summary: null,
          updatedAt: null,
        },
      },
    }
    render(<WorkspaceDetail summary={summary} reads={emptyReads} />)
    const tabTrigger = screen.getByRole('tab', { name: '매장 지식·플레이스' })
    fireEvent.click(tabTrigger)

    expect(screen.getByText('네이버 플레이스 연동 정보가 없어요')).toBeVisible()
  })

  it('renders registration and submission audit section with field provenance in lifecycle tab', () => {
    const mockBusinessInfo: any = {
      status: 'SUBMITTED_PENDING',
      statusLabel: '사업자 정보 제출됨·인증 대기',
      companyName: { value: '소희베이커리', source: 'signup_applications', updatedAt: '2026-10-21T01:00:00Z' },
      representativeName: { value: '이대표', source: 'signup_applications', updatedAt: '2026-10-21T01:00:00Z' },
      businessNumber: { value: '1234567890', source: 'signup_applications', updatedAt: '2026-10-21T01:00:00Z' },
      startDate: { value: '20240101', source: 'business_verifications', updatedAt: '2026-10-21T01:00:00Z' },
      hasDocument: true,
      submittedAt: '2026-10-21T01:00:00Z',
      identityState: 'COMPLETED',
      identityStateLabel: '가입 완료',
      businessSubmissionState: 'SUBMITTED',
      businessSubmissionStateLabel: '사업자 정보 제출됨',
      legalConsentState: 'COMPLETED',
      legalConsentStateLabel: '필수 약관 동의 완료',
      agreements: [
        { type: 'TERMS_OF_SERVICE', label: '서비스 이용약관', agreed: true, agreedAt: '2026-10-21T01:00:00Z', version: '2026.09-v1' },
        { type: 'MARKETING_NOTIFICATIONS', label: '마케팅 성과 및 혜택 알림 수신 동의 (선택)', agreed: false, agreedAt: '2026-10-21T01:00:00Z', version: '2026.09-v1' },
      ],
      marketingConsent: { agreed: false, agreedAt: '2026-10-21T01:00:00Z', version: '2026.09-v1' },
      naverPlace: { url: 'https://naver.me/testplace', status: 'connected' },
      selfReported: null,
      error: null,
    }

    render(<WorkspaceDetail summary={summary} reads={mockReads} businessInfo={mockBusinessInfo} />)
    const lifecycleTab = screen.getByRole('tab', { name: '가입·계약' })
    fireEvent.click(lifecycleTab)

    expect(screen.getByText('가입·제출 기록 및 정합 명세')).toBeVisible()
    expect(screen.getAllByText('가입 완료').length).toBeGreaterThan(0)
    expect(screen.getAllByText('사업자 정보 제출됨').length).toBeGreaterThan(0)
    expect(screen.getAllByText('필수 약관 동의 완료').length).toBeGreaterThan(0)
    expect(screen.getByText('소희베이커리')).toBeVisible()
    expect(screen.getByText('이대표')).toBeVisible()
    expect(screen.getByText('123-45-67890')).toBeVisible()
    expect(screen.getByText('2024년 01월 01일')).toBeVisible()
    expect(screen.getByText('서류 파일 접수됨 (검증 가능)')).toBeVisible()
    expect(screen.getAllByText('출처: 회원가입 신청서').length).toBeGreaterThan(0)
    expect(screen.getByText('서비스 이용약관')).toBeVisible()
    expect(screen.getByText('미동의 (거부)')).toBeVisible()
  })
})

describe('WorkspaceDetail — 사장님 자가 입력 사업자·운영 정보', () => {
  const selfReported = {
    businessNumber: '0000000000',
    representativeName: '홍길동',
    businessStartDate: '20190301',
    businessType: '서비스업',
    businessItem: '속눈썹증모',
    phone: '010-9876-5432',
    businessHours: '평일 10:00~20:00',
    closedDays: '매주 화요일',
    parkingInfo: '건물 지하 3대',
    reservationMethod: '네이버 예약',
    websiteUrl: 'https://blog.naver.com/bairm',
    priceRange: '1인 5~8만원',
    naverPlaceUrl: 'https://naver.me/abc',
    intakeSource: 'manual' as const,
    updatedAt: '2026-10-22T09:09:05Z',
  }

  it('자가 입력 값을 별도 카드로 보여주고 미검증 배지를 고정 노출한다', () => {
    const businessInfo: any = {
      status: 'NOT_SUBMITTED',
      statusLabel: '미제출',
      companyName: { value: null, source: 'none', updatedAt: null },
      representativeName: { value: null, source: 'none', updatedAt: null },
      businessNumber: { value: null, source: 'none', updatedAt: null },
      startDate: { value: null, source: 'none', updatedAt: null },
      hasDocument: false,
      submittedAt: null,
      identityState: 'COMPLETED',
      identityStateLabel: '가입 완료',
      businessSubmissionState: 'NOT_SUBMITTED',
      businessSubmissionStateLabel: '사업자 정보 미제출',
      legalConsentState: 'COMPLETED',
      legalConsentStateLabel: '필수 약관 동의 완료',
      agreements: [],
      marketingConsent: null,
      naverPlace: null,
      selfReported,
      error: null,
    }

    render(<WorkspaceDetail summary={summary} reads={mockReads} businessInfo={businessInfo} />)
    fireEvent.click(screen.getByRole('tab', { name: '매장 지식·플레이스' }))

    expect(screen.getByText('사업자·운영 정보 (사장님 직접 입력)')).toBeVisible()
    // 검증된 정보로 오인하지 않도록 미검증 배지가 반드시 보인다.
    expect(screen.getByText('미검증 · 국세청 확인 전')).toBeVisible()
    expect(screen.getByText('직접 입력')).toBeVisible()
    // 값이 사람이 읽는 형식으로 표시된다.
    expect(screen.getByText('000-00-00000')).toBeVisible()
    expect(screen.getByText('2019년 03월 01일')).toBeVisible()
    expect(screen.getByText('평일 10:00~20:00')).toBeVisible()
    expect(screen.getByText('건물 지하 3대')).toBeVisible()
  })

  it('자가 입력이 없으면 빈 상태를 보여준다', () => {
    const businessInfo: any = {
      status: 'NOT_SUBMITTED', statusLabel: '미제출',
      companyName: { value: null, source: 'none', updatedAt: null },
      representativeName: { value: null, source: 'none', updatedAt: null },
      businessNumber: { value: null, source: 'none', updatedAt: null },
      startDate: { value: null, source: 'none', updatedAt: null },
      hasDocument: false, submittedAt: null,
      identityState: 'COMPLETED', identityStateLabel: '가입 완료',
      businessSubmissionState: 'NOT_SUBMITTED', businessSubmissionStateLabel: '사업자 정보 미제출',
      legalConsentState: 'COMPLETED', legalConsentStateLabel: '필수 약관 동의 완료',
      agreements: [], marketingConsent: null, naverPlace: null,
      selfReported: null, error: null,
    }

    render(<WorkspaceDetail summary={summary} reads={mockReads} businessInfo={businessInfo} />)
    fireEvent.click(screen.getByRole('tab', { name: '매장 지식·플레이스' }))

    expect(screen.getByText('사장님이 아직 입력하지 않았어요')).toBeVisible()
  })
})
