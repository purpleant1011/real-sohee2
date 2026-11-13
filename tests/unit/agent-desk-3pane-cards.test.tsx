import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GoalCard,
  PlanCard,
  ApprovalCard,
  ExecutionCard,
  LiveExecutionCard,
  ProviderAcceptedCard,
  VerificationCard,
  EvidenceCard,
  ResultUnknownCard,
  BlockedCard,
  OutcomeCard,
} from '@/features/action-graph/event-cards';
import { SoheeAgentDock } from '@/components/agent-dock/sohee-agent-dock';
import { V088AppShell } from '@/components/v088/layout/v088-app-shell';
import { SurfaceContextProvider } from '@/features/agent-dock/surface-context';
import { ProposalBusProvider } from '@/features/agent-dock/proposal-bus';

// Mocks for AppShell & AgentDock
let currentPathname = '/app';
vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock('next/image', () => ({
  default: ({ priority: _priority, ...props }: any) => <img {...props} alt={props.alt || ''} />,
}));

vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', resolvedTheme: 'light', setTheme: vi.fn() }),
}));

vi.mock('@/hooks/use-credit-balance', () => ({
  useCreditBalance: () => ({
    capacity: 5000,
    balance: 5000,
    remainingPercentage: 100,
  }),
}));

vi.mock('@/hooks/use-sohee-autonomy', () => ({
  useSoheeAutonomy: () => ({
    isRunning: true,
    actualMode: 'RUNNING',
    killSwitchActive: false,
    isLoading: false,
    setAutonomy: vi.fn(),
    toggleAutonomy: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-agent-session', () => ({
  useAgentSession: () => ({
    sessionId: 'session-canonical-001',
    threadId: 'thread-canonical-001',
    isLoading: false,
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            email: 'owner@byreum.kr',
            user_metadata: { full_name: '바이름 원장님' },
          },
        },
      }),
    },
    from: () => ({
      select: () => ({
        limit: () => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { business_name: '바이름 뷰티스튜디오' },
          }),
        }),
        in: () => ({
          limit: () => vi.fn().mockResolvedValue({ data: [] }),
        }),
      }),
    }),
  }),
}));

describe('Task 5.1: Agent Desk 3-Pane Shell & 10 Structured State Cards (ANI-986, ANI-976, ANI-957)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentPathname = '/app';
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, messages: [] }),
    })) as any;
  });

  // =========================================================================
  // Section 1: 10대 정형 이벤트 상태 카드 렌더링 검증
  // =========================================================================
  describe('1. 10대 정형 이벤트 상태 카드 (Structured Event Cards)', () => {
    it('1) GoalCard: 사용자 목표 및 정규화 의도를 렌더링한다', () => {
      render(
        <GoalCard
          goalId="goal-101"
          userGoal="이번 주말 봄맞이 속눈썹 펌 20% 할인 이벤트 홍보해줘"
          normalizedIntent="MARKETING_CAMPAIGN_CREATE: 봄맞이 속눈썹 펌 프로모션"
          intentCategory="CAMPAIGN"
          parameters={{ discountRate: 20, service: '속눈썹 펌' }}
        />
      );

      expect(screen.getByTestId('event-card-goal')).toBeDefined();
      expect(screen.getByText('GOAL')).toBeDefined();
      expect(screen.getByText(/이번 주말 봄맞이 속눈썹 펌 20% 할인 이벤트 홍보해줘/)).toBeDefined();
      expect(screen.getByText(/MARKETING_CAMPAIGN_CREATE: 봄맞이 속눈썹 펌 프로모션/)).toBeDefined();
      expect(screen.getByText('CAMPAIGN')).toBeDefined();
    });

    it('2) PlanCard: 단계별 플랜 노드 및 종속성 그래프를 렌더링한다', () => {
      render(
        <PlanCard
          plan={{
            planId: 'plan-202',
            title: '인스타그램 피드 제작 및 광고 부스팅 플랜',
            totalSC: 250,
            requiresApproval: true,
            steps: [
              { name: '타겟 분석 및 카피 생성', sc: 50, risk: 'LOW' },
              { name: '고해상도 비주얼 카드 생성', sc: 100, risk: 'MEDIUM' },
              { name: '메타 광고 즉시 집행', sc: 100, risk: 'HIGH' },
            ],
            dependencies: [
              { from: 'step-1', to: 'step-2' },
              { from: 'step-2', to: 'step-3' },
            ],
          }}
        />
      );

      expect(screen.getByTestId('event-card-plan')).toBeDefined();
      expect(screen.getByText('계획')).toBeDefined();
      expect(screen.getByText('인스타그램 피드 제작 및 광고 부스팅 플랜')).toBeDefined();
      expect(screen.getByText(/총 250 (SC|크레딧)/)).toBeDefined();
      expect(screen.getByText(/사전 승인/)).toBeDefined();
      expect(screen.getByText('타겟 분석 및 카피 생성')).toBeDefined();
      expect(screen.getByText('주의')).toBeDefined();

      // 전체보기 클릭 후 3단계(HIGH->확인 필요) 노출 확인
      const expandBtn = screen.getByRole('button', { name: /전체보기/ });
      fireEvent.click(expandBtn);
      expect(screen.getByText('확인 필요')).toBeDefined();
      expect(screen.getByText('메타 광고 즉시 집행')).toBeDefined();

      // 종속성 안내 표시 확인
      expect(screen.getByText(/의존성|dependencies/i)).toBeDefined();
    });

    it('3) ApprovalCard: 사장님 승인 요청 시 CAS expectedVersion과 변경 diff를 노출한다', async () => {
      const onApprove = vi.fn().mockResolvedValue(undefined);
      const onReject = vi.fn().mockResolvedValue(undefined);

      render(
        <ApprovalCard
          card={{
            decisionId: 'dec-303',
            title: '인스타그램 피드 발행 및 메타 광고 집행 승인',
            expectedVersion: 4,
            diff: {
              before: { budget: 30000, status: 'DRAFT' },
              after: { budget: 50000, status: 'PUBLISHED' },
            },
            diffSummary: '예산 30,000원 -> 50,000원 증액 (+20,000원)',
            options: [{ id: 'opt-go', label: '즉시 승인 및 집행', sc: 200 }],
          }}
          onApprove={onApprove}
          onReject={onReject}
        />
      );

      expect(screen.getByTestId('event-card-approval')).toBeDefined();
      expect(screen.getByText('APPROVAL_REQUIRED')).toBeDefined();
      // CAS expectedVersion 노출 검증
      expect(screen.getByText('CAS v4')).toBeDefined();
      // 변경 diff 요약 노출 검증
      expect(screen.getByText(/예산 30,000원 -> 50,000원 증액/)).toBeDefined();

      const approveBtn = screen.getByRole('button', { name: /승인 및 실행/ });
      fireEvent.click(approveBtn);
      expect(onApprove).toHaveBeenCalledWith('dec-303', 'opt-go');

      await waitFor(() => {
        expect(screen.getByText(/승인 완료/)).toBeDefined();
      });
    });

    it('4) ExecutionCard: 실행 중 진행률과 실시간 디스패치 상태를 렌더링한다', () => {
      render(
        <ExecutionCard
          card={{
            planId: 'plan-404',
            progressPercentage: 80,
            currentStepName: 'meta_ads.campaign_create 실행 중',
            status: 'RUNNING',
            dispatchStatus: 'DISPATCHED',
            logs: ['MCP 툴 파라미터 검증 완료', '메타 그래프 API 호출 진행 중'],
          }}
        />
      );

      expect(screen.getByTestId('event-card-execution')).toBeDefined();
      expect(screen.getByText('80%')).toBeDefined();
      expect(screen.getByText('meta_ads.campaign_create 실행 중')).toBeDefined();
      expect(screen.getByText('DISPATCHED')).toBeDefined();
      expect(screen.getByText(/메타 그래프 API 호출 진행 중/)).toBeDefined();
    });

    it('5) ProviderAcceptedCard: 프로바이더 수신 영수증(providerReference)을 렌더링한다', () => {
      render(
        <ProviderAcceptedCard
          providerReference="act_meta_ads_req_987654321"
          providerId="META_ADS"
          actionRunId="act-run-777"
          acceptedAt="2026-09-07T04:25:00Z"
          message="메타 광고 플랫폼이 캠페인 생성 요청을 정상 수신했습니다."
        />
      );

      expect(screen.getByTestId('event-card-provider-accepted')).toBeDefined();
      // 영문 상태 코드는 노출하지 않고, 접수만 됐을 뿐 게시 확인 전이라는 사실을 한국어로 보여준다
      expect(screen.getByText('플랫폼 접수 · 게시 확인 전')).toBeDefined();
      expect(screen.queryByText('PROVIDER_ACCEPTED')).toBeNull();
      expect(screen.getByText('act_meta_ads_req_987654321')).toBeDefined();
      expect(screen.getByText('META_ADS')).toBeDefined();
      expect(screen.getByText(/메타 광고 플랫폼이 캠페인 생성 요청을 정상 수신/)).toBeDefined();
    });

    it('6) VerificationCard: 독립 리드백 진행 중 및 완료 상태를 렌더링한다', () => {
      const { rerender } = render(
        <VerificationCard
          verificationId="verif-101"
          status="IN_PROGRESS"
          targetChannel="INSTAGRAM"
          targetUrl="https://instagram.com/p/byreum_spring_promo"
          isIndependentReadback={true}
        />
      );

      expect(screen.getByTestId('event-card-verification')).toBeDefined();
      expect(screen.getByText('VERIFICATION')).toBeDefined();
      expect(screen.getByText(/독립 리드백/)).toBeDefined();
      expect(screen.getByText(/검증 진행 중|IN_PROGRESS/)).toBeDefined();

      rerender(
        <VerificationCard
          verificationId="verif-101"
          status="COMPLETED"
          targetChannel="INSTAGRAM"
          targetUrl="https://instagram.com/p/byreum_spring_promo"
          readbackResult="HTTP 200 OK, 게시물 live 상태 확인됨"
          isIndependentReadback={true}
          verifiedAt="2026-09-07T04:26:00Z"
        />
      );

      expect(screen.getByText(/검증 완료|COMPLETED/)).toBeDefined();
      expect(screen.getByText(/HTTP 200 OK, 게시물 live 상태 확인됨/)).toBeDefined();
    });

    it('7) EvidenceCard: SHA-256 증거 블록, 해시 링크, 영수증 뷰어를 제공한다', () => {
      const onNavigate = vi.fn();
      const onViewReceipt = vi.fn();

      render(
        <EvidenceCard
          evidence={{
            settledSC: 250,
            sha256: 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0',
            receiptId: 'rcpt-sha256-20260907',
            proofChainIndex: 12,
            verifiedUrls: [
              {
                channel: 'INSTAGRAM',
                url: 'https://instagram.com/p/byreum_spring_promo',
                httpStatus: 200,
              },
            ],
            navUrl: '/app/content',
            navLabel: '콘텐츠 스튜디오에서 확인',
          }}
          onNavigate={onNavigate}
          onViewReceipt={onViewReceipt}
        />
      );

      expect(screen.getByTestId('event-card-evidence')).toBeDefined();
      expect(screen.getByText('VERIFIED_EVIDENCE')).toBeDefined();
      expect(screen.getByText(/250 (SC|크레딧) 정산/)).toBeDefined();
      // SHA-256 해시 블록 노출 확인
      expect(screen.getByText(/a1b2c3d4e5f67890/)).toBeDefined();
      // 영수증 뷰어 버튼 확인
      const receiptBtn = screen.getByRole('button', { name: /영수증 확인|영수증 뷰어/i });
      fireEvent.click(receiptBtn);
      expect(onViewReceipt).toHaveBeenCalledWith('rcpt-sha256-20260907');
    });

    it('8) ResultUnknownCard: blind retry 버튼을 절대 노출하지 않고 오직 수동 reconcile CTA만 노출한다', () => {
      const onReconcile = vi.fn();

      render(
        <ResultUnknownCard
          actionRunId="act-run-unknown-999"
          message="외부 플랫폼 응답 지연으로 작업 완료 여부가 불명확합니다."
          reason="외부 타임아웃 발생 (중복 집행 방지 위해 자동 재시도 금지)"
          onReconcile={onReconcile}
        />
      );

      expect(screen.getByTestId('event-card-result-unknown')).toBeDefined();
      expect(screen.getByText('결과 확인 중')).toBeDefined();
      expect(screen.queryByText('RESULT_UNKNOWN')).toBeNull();
      expect(screen.getByText(/외부 플랫폼 응답 지연으로 작업 완료 여부가 불명확/)).toBeDefined();

      // ★ 핵심 검증: Blind Retry 버튼이 존재하지 않아야 함!
      const retryButtons = screen.queryAllByRole('button', { name: /재시도|retry|다시 시도/i });
      expect(retryButtons).toHaveLength(0);

      // ★ 핵심 검증: 수동 Reconcile CTA 버튼이 노출되어야 함!
      const reconcileBtn = screen.getByTestId('reconcile-cta-button');
      expect(reconcileBtn).toBeDefined();
      expect(reconcileBtn.textContent).toMatch(/대사|reconcile/i);

      fireEvent.click(reconcileBtn);
      expect(onReconcile).toHaveBeenCalledWith('act-run-unknown-999');
    });

    it('9) BlockedCard: 킬스위치, 권한 부족, 정책 위반 안내를 표시한다', () => {
      const onUnblock = vi.fn();

      render(
        <BlockedCard
          errorCode="KILL_SWITCH_ACTIVE"
          reason="KILL_SWITCH"
          message="사장님 긴급 정지(Kill Switch)가 활성화되어 모든 외부 변경이 차단되었습니다."
          step="ads.dispatch"
          onUnblock={onUnblock}
        />
      );

      expect(screen.getByTestId('event-card-blocked')).toBeDefined();
      expect(screen.getByText('BLOCKED')).toBeDefined();
      expect(screen.getByText('KILL_SWITCH_ACTIVE')).toBeDefined();
      expect(screen.getByText(/긴급 정지/)).toBeDefined();

      const unblockBtn = screen.getByRole('button', { name: /차단 해제/i });
      fireEvent.click(unblockBtn);
      expect(onUnblock).toHaveBeenCalledTimes(1);
    });

    it('10) OutcomeCard: 최종 비즈니스 결과(매출, 예약 확정, 게시 완료)를 렌더링한다', () => {
      render(
        <OutcomeCard
          outcomeType="REVENUE"
          title="봄맞이 프로모션 당일 매출 목표 달성"
          summary="속눈썹 펌 및 눈썹 세트 8건 예약 완료로 일일 매출 560,000원 달성"
          metrics={[
            { label: '확정 매출', value: '₩560,000' },
            { label: '신규 예약', value: '8건' },
            { label: 'ROAS', value: '420%' },
          ]}
          completedAt="2026-09-07T04:20:00Z"
        />
      );

      expect(screen.getByTestId('event-card-outcome')).toBeDefined();
      expect(screen.getByText('OUTCOME')).toBeDefined();
      expect(screen.getByText('봄맞이 프로모션 당일 매출 목표 달성')).toBeDefined();
      expect(screen.getByText(/560,000원 달성/)).toBeDefined();
      expect(screen.getByText('₩560,000')).toBeDefined();
      expect(screen.getByText('420%')).toBeDefined();
    });
  });

  // =========================================================================
  // Section 2: V0.92 점진적 노출 셸 및 경로 이동 중 도크 유지 검증
  // =========================================================================
  describe('2. 반응형 셸과 필요할 때 여는 소희 도크 (`V088AppShell` & `SoheeAgentDock`)', () => {
    it('Business World와 Workbench를 보여주고, 대화 버튼으로 도크를 열고 닫는다', async () => {
      render(
        <V088AppShell workspaceId="ws-test">
          <div data-testid="workbench-content">중앙 캔버스 워크벤치</div>
        </V088AppShell>
      );

      // 1) 좌측 Business World 내비게이션 셸
      expect(screen.getByTestId('business-world-pane')).toBeDefined();
      // 12대 비즈니스 영역 라우트/내비게이션 링크 확인
      expect(screen.getAllByText('오늘').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('작업').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('고객').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('성과').length).toBeGreaterThanOrEqual(1);

      // 2) 중앙 Canonical Workbench
      expect(screen.getByTestId('workbench-pane')).toBeDefined();
      expect(screen.getByTestId('workbench-content')).toBeDefined();

      // 3) 도크는 기본 닫힘, 요청 시 우측 드로어로 열리고 다시 닫힘
      expect(screen.queryByTestId('sohee-agent-dock')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '소희와 대화하기' }));
      expect(screen.getByTestId('sohee-agent-dock')).toBeDefined();
      expect(screen.getByRole('button', { name: '대화창 닫기' })).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: '대화창 닫기' }));
      await waitFor(() => expect(screen.queryByTestId('sohee-agent-dock')).toBeNull());
    });

    it('열린 도크는 경로 이동(customers -> content -> campaigns -> results)에도 세션과 ActionRun을 유지하고 화면 맥락을 갱신한다', async () => {
      global.fetch = vi.fn().mockImplementation(async (_url, options) => ({
        ok: true,
        status: 200,
        json: async () => options?.method === 'POST'
          ? { reply: '캠페인 준비 중입니다.', runId: 'run-route-123', step: 'RUNNING' }
          : { success: true, messages: [] },
      })) as any;
      const { rerender } = render(
        <V088AppShell workspaceId="ws-test">
          <div data-testid="page-customers">고객 CRM 워크벤치</div>
        </V088AppShell>
      );

      expect(screen.getByTestId('page-customers')).toBeDefined();
      expect(screen.queryByTestId('sohee-agent-dock')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '소희와 대화하기' }));
      const dock = screen.getByTestId('sohee-agent-dock');
      const greeting = screen.getByText(/안녕하세요 사장님! 마케팅을 돕는 AI 직원 소희예요/);
      expect(dock).toBeDefined();
      expect(screen.getByText('화면 인지: 홈 워크벤치')).toBeDefined();
      fireEvent.change(screen.getByPlaceholderText('예: 이번 주말 신메뉴 글 올려줘'), {
        target: { value: '봄맞이 고객 유치 캠페인' },
      });
      fireEvent.click(screen.getByRole('button', { name: '소희에게 메시지 전송' }));
      await waitFor(() => {
        expect(screen.getByText('진행 중인 작업')).toBeDefined();
        expect(screen.getByText('캠페인 준비 중입니다.')).toBeDefined();
      });
      const run = screen.getByText('진행 중인 작업');

      // 라우트 이동: content
      currentPathname = '/app/content';
      rerender(
        <V088AppShell workspaceId="ws-test">
          <div data-testid="page-content">콘텐츠 스튜디오 워크벤치</div>
        </V088AppShell>
      );
      expect(screen.getByTestId('page-content')).toBeDefined();
      expect(screen.getByTestId('sohee-agent-dock')).toBe(dock);
      expect(screen.getByText('화면 인지: 콘텐츠 센터')).toBeDefined();
      expect(screen.getByText(/안녕하세요 사장님! 마케팅을 돕는 AI 직원 소희예요/)).toBe(greeting);
      expect(screen.getByText('진행 중인 작업')).toBe(run);

      // 라우트 이동: campaigns
      currentPathname = '/app/campaigns';
      rerender(
        <V088AppShell workspaceId="ws-test">
          <div data-testid="page-campaigns">캠페인 워크벤치</div>
        </V088AppShell>
      );
      expect(screen.getByTestId('page-campaigns')).toBeDefined();
      expect(screen.getByTestId('sohee-agent-dock')).toBe(dock);
      expect(screen.getByText('화면 인지: 나의 소희 (설정·지휘·학습)')).toBeDefined();
      expect(screen.getByText('진행 중인 작업')).toBe(run);

      // 라우트 이동: results
      currentPathname = '/app/results';
      rerender(
        <V088AppShell workspaceId="ws-test">
          <div data-testid="page-results">성과 분석 워크벤치</div>
        </V088AppShell>
      );
      expect(screen.getByTestId('page-results')).toBeDefined();
      expect(screen.getByTestId('sohee-agent-dock')).toBe(dock);
      expect(screen.getByText('화면 인지: 성과 분석실')).toBeDefined();
      expect(screen.getByText('진행 중인 작업')).toBe(run);
      expect(screen.getByText('캠페인 준비 중입니다.')).toBeDefined();
    });
  });

  // =========================================================================
  // Section 3: SoheeAgentDock 독립 컴포넌트 검증
  // =========================================================================
  describe('3. SoheeAgentDock 컴포넌트 동작 검증', () => {
    it('세션 지속성 및 ActionRun 인스펙터, 10대 상태 카드 렌더링 지원', () => {
      render(
        <SurfaceContextProvider>
          <ProposalBusProvider>
            <SoheeAgentDock
              workspaceId="ws-test"
              isOpen={true}
              initialActionRun={{
                runId: 'run-alpha-123',
                goal: '봄맞이 고객 유치 캠페인',
                status: 'RUNNING',
                progress: 60,
              }}
            />
          </ProposalBusProvider>
        </SurfaceContextProvider>
      );

      expect(screen.getByTestId('sohee-agent-dock')).toBeDefined();
      expect(screen.getByText('소희 (자율 에이전트)')).toBeDefined();
      // ActionRun 정보 노출 확인
      expect(screen.getByText('진행 중인 작업')).toBeDefined();
      expect(screen.queryByText(/run-alpha-123/)).toBeNull();
      expect(screen.getByText(/봄맞이 고객 유치 캠페인/)).toBeDefined();
    });
  });
});
