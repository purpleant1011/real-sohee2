import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TodayOperationsDashboard } from '../TodayOperationsDashboard';
import { HarnessStudioEditor } from '../HarnessStudioEditor';
import { ProposalInboxCenter } from '../ProposalInboxCenter';
import { ActivityProofTimeline } from '../ActivityProofTimeline';
import { SecondaryChatAdvisorDrawer } from '../SecondaryChatAdvisorDrawer';
import { AdminFleetControlTower } from '../AdminFleetControlTower';
import { AdminCustomer360Timeline } from '../AdminCustomer360Timeline';
import type {
  WorkspaceKnowledgeHarness,
  WorkProposal,
  AgentEnergyLedger,
  GoalContract,
} from '@/types/autonomous-outcome-os';

describe('Milestone 3: Service Core UX & Admin Operations Control Tower (ANI-674 ~ ANI-678, ANI-687, ANI-688, ANI-697)', () => {
  const mockWorkspaceId = 'ws_ux_test_01';

  const mockHarness: WorkspaceKnowledgeHarness = {
    harnessVersionId: 'harness_v1_test',
    workspaceId: mockWorkspaceId,
    versionNo: 1,
    compiledAt: new Date().toISOString(),
    isActive: true,
    businessIdentity: {
      businessName: '강남 바이름 뷰티살롱',
      brandSummary: '소상공인 전문 뷰티살롱',
      locationDistrict: '서울시 강남구',
      operatingHours: '10:00 - 20:00',
      contactChannels: ['instagram'],
      facts: {},
    },
    offerings: [
      {
        id: 'off_1',
        title: '시그니처 케어',
        price: 80000,
        discountCapPercent: 10,
        reservationRequired: true,
        promotionalPriority: 1,
      },
    ],
    audience: {
      primaryTarget: '2040 직장인',
      targetRegions: ['강남구'],
      restrictedDemographics: [],
    },
    brandVoice: {
      tone: 'WARM_POLITE',
      prohibitedKeywords: ['공짜'],
      mandatoryDisclaimers: ['사전 예약 필수'],
      channelSpecificExpressions: {},
    },
    policies: {
      maxDiscountPercent: 10,
      allowDirectMessaging: true,
      dmRequiresApproval: true,
      maxPostsPerDay: 2,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
    },
    channelTruth: {
      instagram: {
        connected: true,
        tenantId: 'meta_123',
        verifiedHandle: '@sohee_official',
        supportedCapabilities: ['FEED_POST'],
      },
    },
  };

  const mockEnergyLedger: AgentEnergyLedger = {
    workspaceId: mockWorkspaceId,
    planTier: 'TIER_300K_GROWTH',
    monthlyTotalEnergy: 3000,
    usedEnergyCurrentMonth: 450,
    reservedEnergyActiveRuns: 100,
    remainingAvailableEnergy: 2450,
    burnRatePercentage: 18,
    budgetAlertStage: 'NORMAL',
    forecastRunOutDays: 24,
    updatedAt: new Date().toISOString(),
  };

  const mockProposal: WorkProposal = {
    proposalId: 'prop_01',
    workspaceId: mockWorkspaceId,
    goalId: 'goal_01',
    title: '주중 오후 빈자리 예약 유치 캠페인',
    rationale: '주중 14시~17시 예약 공실률 35% 포착',
    evidenceContext: ['과거 전환율 +20%'],
    expectedOutcome: {
      metricType: 'BOOKING_COUNT',
      estimatedMin: 3,
      estimatedMax: 6,
    },
    executionPlanSummary: ['인스타그램 피드 2회 포스팅', '예약 링크 안내'],
    requiredCapabilities: ['mcp_publish_live'],
    estimatedAgentEnergy: 150,
    proposedEnvelope: {
      workspaceId: mockWorkspaceId,
      title: '주중 오후 승인 범위',
      autonomyLevel: 'A3_ENVELOPE_AUTONOMY',
      validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + 86400000 * 30).toISOString(),
      allowedChannels: ['instagram'],
      maxPostsPerDay: 2,
      maxDiscountPercentAllowed: 10,
      dmPolicy: 'AUTONOMOUS',
      maxAgentEnergyCap: 300,
      riskCeiling: 'R1_MODERATE',
      prohibitedActions: [],
    },
    status: 'PROPOSED',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000 * 7).toISOString(),
  };

  describe('ANI-674: Today Operations Dashboard', () => {
    it('renders the 6 core questions of Sohee Product Constitution clearly', () => {
      render(
        <TodayOperationsDashboard
          harness={mockHarness}
          energyLedger={mockEnergyLedger}
          pendingProposals={[mockProposal]}
          verifiedOutcomesCount={12}
          currentRunningTask="스레드 고객 문의 댓글 분석 및 답변 초안 작성 중"
        />
      );

      expect(screen.getByText('강남 바이름 뷰티살롱')).toBeDefined();
      expect(screen.getByText('소희가 지금 하고 있는 일')).toBeDefined();
      expect(screen.getByText('스레드 고객 문의 댓글 분석 및 답변 초안 작성 중')).toBeDefined();
      expect(screen.getByText('승인 필요 제안')).toBeDefined();
      expect(screen.getByText('주중 오후 빈자리 예약 유치 캠페인')).toBeDefined();
      expect(screen.getByText('12건 달성')).toBeDefined(); // Verified outcomes
      expect(screen.getByText('2,450 / 3,000 Energy')).toBeDefined(); // Agent energy
    });

    it('renders safely without crashing when energyLedger is null and shows guidance text', () => {
      render(
        <TodayOperationsDashboard
          harness={mockHarness}
          energyLedger={null}
          pendingProposals={[]}
          verifiedOutcomesCount={0}
        />
      );

      const guidanceTexts = screen.getAllByText('크레딧 정보를 확인할 수 없어요');
      expect(guidanceTexts.length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText(/50/)).toBeNull();
      expect(screen.queryByText(/30일/)).toBeNull();
    });

    it('displays fallback when forecastRunOutDays is null without showing hardcoded days', () => {
      const ledgerWithoutForecast: AgentEnergyLedger = {
        ...mockEnergyLedger,
        forecastRunOutDays: null,
      };

      render(
        <TodayOperationsDashboard
          harness={mockHarness}
          energyLedger={ledgerWithoutForecast}
          pendingProposals={[]}
          verifiedOutcomesCount={0}
        />
      );

      expect(screen.getByText('예측 정보 없음')).toBeDefined();
      expect(screen.queryByText(/30일/)).toBeNull();
      expect(screen.queryByText(/24일/)).toBeNull();
    });
  });

  describe('ANI-675: Knowledge Harness Studio UX', () => {
    it('renders versioned business knowledge tabs and allow fact edits', () => {
      render(<HarnessStudioEditor harness={mockHarness} onSave={vi.fn()} />);

      expect(screen.getByText(/기준 버전/)).toBeDefined();
      expect(screen.getByText('harness_v1_test')).toBeDefined();
      expect(screen.getByText('정체성 & 영업시간')).toBeDefined();
      expect(screen.getByText('브랜드 보이스')).toBeDefined();
      expect(screen.getByText('운영 정책')).toBeDefined();
    });
  });

  describe('ANI-676: Proposal Inbox + Automation Center', () => {
    it('allows one-click approval of proposal with Approval Envelope generation', () => {
      const onApprove = vi.fn();
      render(
        <ProposalInboxCenter
          proposals={[mockProposal]}
          onApproveProposal={onApprove}
          onRejectProposal={vi.fn()}
        />
      );

      expect(screen.getByText('주중 오후 빈자리 예약 유치 캠페인')).toBeDefined();
      expect(screen.getByText(/예약 공실률 35%/)).toBeDefined();

      const approveBtn = screen.getByRole('button', { name: /승인하고 자율 실행 시작/i });
      fireEvent.click(approveBtn);

      expect(onApprove).toHaveBeenCalledWith('prop_01');
    });
  });

  describe('ANI-677: Activity Proof Timeline', () => {
    it('displays evidence receipts rather than plain chat text', () => {
      const mockActivities = [
        {
          id: 'act_01',
          time: '09:00',
          title: '인스타그램 특가 피드 게시',
          status: 'VERIFIED',
          evidenceUrl: 'https://instagram.com/p/verified123',
          costEnergy: 80,
        },
      ];

      render(<ActivityProofTimeline activities={mockActivities} />);

      expect(screen.getByText('인스타그램 특가 피드 게시')).toBeDefined();
      expect(screen.getByText('외부 검증 완료')).toBeDefined();
      expect(screen.getByText(/80 Energy/)).toBeDefined();
    });
  });

  describe('ANI-678: Secondary Chat Advisor Drawer', () => {
    it('opens secondary drawer for explanation, negotiation and quick strategy adjustment', () => {
      const onSend = vi.fn();
      render(
        <SecondaryChatAdvisorDrawer
          isOpen={true}
          onClose={vi.fn()}
          onSendMessage={onSend}
        />
      );

      expect(screen.getByText('소희 어드바이저')).toBeDefined();
      expect(screen.getByText('오늘 뭐 하고 있어?')).toBeDefined();
      expect(screen.getByText('이번 주는 비용 아껴줘')).toBeDefined();
    });
  });

  describe('ANI-687 & ANI-688: Admin Fleet Overview & Customer 360', () => {
    it('renders Fleet Overview control tower with active automations, lag, and kill-switch status', () => {
      render(
        <AdminFleetControlTower
          totalWorkspaces={1420}
          activeAutomations={389}
          schedulerLagSeconds={1.2}
          killSwitchState="NORMAL"
        />
      );

      expect(screen.getByText('Autonomous Operations Control Tower')).toBeDefined();
      expect(screen.getByText('1,420')).toBeDefined();
      expect(screen.getByText('389')).toBeDefined();
      expect(screen.getByText('1.2s')).toBeDefined();
    });

    it('renders Customer 360 3-hop trace chain for deep lineage audit', () => {
      const traceData = {
        workspaceId: mockWorkspaceId,
        goal: '예약 30건 증대',
        harnessVersion: 'harness_v18_prod',
        proposal: '주중 타임세일',
        envelope: '30일 인스타 자율운영',
        agentBuild: 'v0.9.0-gemini-flash-prod',
        runId: 'run_99982',
        receipt: 'rcpt_meta_7718',
        outcome: '예약 3건 성약',
      };

      render(<AdminCustomer360Timeline trace={traceData} />);

      expect(screen.getByText('Customer 360 Lineage Trace')).toBeDefined();
      expect(screen.getByText('harness_v18_prod')).toBeDefined();
      expect(screen.getByText('v0.9.0-gemini-flash-prod')).toBeDefined();
      expect(screen.getByText('rcpt_meta_7718')).toBeDefined();
      expect(screen.getByText('예약 3건 성약')).toBeDefined();
    });
  });
});
