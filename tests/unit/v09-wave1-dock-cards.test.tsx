import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  PlanCard,
  ApprovalCard,
  LiveExecutionCard,
  EvidenceCard,
  BlockedCard,
  ResultUnknownCard,
} from '@/components/agent-dock/event-cards';
import {
  PlanCardData,
  LiveExecutionCardData,
  DecisionCardData,
  EvidenceResultCardData,
} from '@/lib/agent-os/agent-orchestrator';

describe('ANI-921: Structured Event Cards for Universal Agent Dock', () => {
  describe('1. PlanCard', () => {
    it('renders plan title, total SC, steps with risk badges, and approval warning', () => {
      const plan: PlanCardData = {
        planId: 'plan-101',
        title: '신규 고객 유치 캠페인 기획',
        totalSC: 450,
        requiresApproval: true,
        steps: [
          { name: '고객 타겟 오디언스 분석', sc: 50, risk: 'LOW' },
          { name: '맞춤형 인스타그램 피드 생성', sc: 200, risk: 'MEDIUM' },
          { name: '메타 광고 즉시 집행', sc: 200, risk: 'HIGH' },
        ],
      };

      render(<PlanCard plan={plan} />);

      expect(screen.getByTestId('event-card-plan')).toBeDefined();
      expect(screen.getByText('신규 고객 유치 캠페인 기획')).toBeDefined();
      expect(screen.getByText('총 450 크레딧')).toBeDefined();
      expect(screen.getByText('실행 전 사장님의 사전 승인이 필요한 계획입니다.')).toBeDefined();
      expect(screen.getByText('고객 타겟 오디언스 분석')).toBeDefined();
      expect(screen.getByText('안전')).toBeDefined();
    });

    it('never renders English PLAN badge, raw LOW risk, or tool id titles on screen', () => {
      const plan: PlanCardData = {
        planId: 'plan-dot-title',
        title: 'content.generate 실행 플랜',
        totalSC: 100,
        requiresApproval: false,
        steps: [
          { name: '원고 생성', sc: 100, risk: 'LOW' },
        ],
      };

      render(<PlanCard plan={plan} />);

      // PLAN badge replaced with Korean '계획'
      expect(screen.getByText('계획')).toBeDefined();
      expect(screen.queryByText('PLAN')).toBeNull();

      // Tool id like content.generate replaced with '작업 계획'
      expect(screen.getByText('작업 계획')).toBeDefined();
      expect(screen.queryByText(/content\.generate/)).toBeNull();

      // LOW risk replaced with '안전'
      expect(screen.getByText('안전')).toBeDefined();
      expect(screen.queryByText('LOW')).toBeNull();
    });
  });

  describe('2. ApprovalCard', () => {
    it('renders decision title, options, and handles approval action', async () => {
      const onApprove = vi.fn().mockResolvedValue(undefined);
      const onReject = vi.fn().mockResolvedValue(undefined);

      const decision: DecisionCardData = {
        decisionId: 'dec-202',
        title: '메타 광고 예산 100,000원 증액 승인',
        options: [
          {
            id: 'opt-1',
            label: '일일 예산 10,000원 증액',
            description: '예상 도달 수 +1,200명',
            sc: 100,
          },
        ],
      };

      render(
        <ApprovalCard
          card={decision}
          onApprove={onApprove}
          onReject={onReject}
        />
      );

      expect(screen.getByTestId('event-card-approval')).toBeDefined();
      expect(screen.getByText('APPROVAL_REQUIRED')).toBeDefined();
      expect(screen.getByText('메타 광고 예산 100,000원 증액 승인')).toBeDefined();
      expect(screen.getByText('일일 예산 10,000원 증액')).toBeDefined();

      // Click Approve
      const approveBtn = screen.getByRole('button', { name: /승인 및 실행/ });
      fireEvent.click(approveBtn);

      expect(onApprove).toHaveBeenCalledWith('dec-202', 'opt-1');
      await waitFor(() => {
        expect(screen.getByText(/승인 완료: 실행 결과는 별도로 확인해야 합니다/)).toBeDefined();
      });
    });

    it('handles rejection action correctly', async () => {
      const onApprove = vi.fn().mockResolvedValue(undefined);
      const onReject = vi.fn().mockResolvedValue(undefined);

      const decision: DecisionCardData = {
        decisionId: 'dec-303',
        title: '포스팅 즉시 발행 승인',
        options: [{ id: 'opt-pub', label: '인스타그램 즉시 발행' }],
      };

      render(
        <ApprovalCard
          card={decision}
          onApprove={onApprove}
          onReject={onReject}
        />
      );

      const rejectBtn = screen.getByRole('button', { name: /반려/ });
      fireEvent.click(rejectBtn);

      expect(onReject).toHaveBeenCalledWith('dec-303');
      await waitFor(() => {
        expect(screen.getByText(/반려됨: 작업이 취소되었습니다/)).toBeDefined();
      });
    });
  });

  describe('3. LiveExecutionCard', () => {
    it('renders current step name, progress bar, and execution status', () => {
      const liveCard: LiveExecutionCardData = {
        planId: 'plan-404',
        progressPercentage: 65,
        currentStepName: 'publish.create 실행 중',
        status: 'RUNNING',
        logs: ['도구 파라미터 검증 완료', '외부 공급자 API 호출 중...'],
      };

      render(<LiveExecutionCard card={liveCard} />);

      expect(screen.getByTestId('event-card-execution')).toBeDefined();
      expect(screen.getByText('65%')).toBeDefined();
      expect(screen.getByText('publish.create 실행 중')).toBeDefined();
      expect(screen.getByText(/외부 공급자 API 호출 중/)).toBeDefined();
    });

    it('strips parentheses status suffix and filters technical log lines', () => {
      const liveCard: LiveExecutionCardData = {
        planId: 'plan-completed-test',
        progressPercentage: 100,
        currentStepName: '콘텐츠 원고 작성 (COMPLETED)',
        status: 'COMPLETED',
        logs: [
          '동적 역량 디스커버리 완료 (서피스: CHAT, 활성 도구: 10종, 제외: 2종)',
          '[Iteration 1] 도구 호출 1건 감지: content.generate',
          '실행 모드: DRAFT',
          '작업 의도 및 권한 게이트 확인 완료',
        ],
      };

      render(<LiveExecutionCard card={liveCard} />);

      // (COMPLETED) suffix stripped
      expect(screen.getByText('콘텐츠 원고 작성')).toBeDefined();
      expect(screen.queryByText(/\(COMPLETED\)/)).toBeNull();
      expect(screen.queryByText(/content\.generate/)).toBeNull();

      // Technical logs filtered
      expect(screen.queryByText(/서피스/)).toBeNull();
      expect(screen.queryByText(/활성 도구/)).toBeNull();
      expect(screen.queryByText(/Iteration/)).toBeNull();
      expect(screen.queryByText(/실행 모드/)).toBeNull();

      // User-friendly log remains
      expect(screen.getByText(/작업 의도 및 권한 게이트 확인 완료/)).toBeDefined();
    });
  });

  describe('4. EvidenceCard', () => {
    it('renders settled SC, verified platform URLs with 200 OK status, and navigate button', () => {
      const onNavigate = vi.fn();
      const evidence: EvidenceResultCardData = {
        settledSC: 151,
        verifiedUrls: [
          {
            channel: 'INSTAGRAM',
            url: 'https://instagram.com/p/byreum123',
            httpStatus: 200,
          },
        ],
        navUrl: '/app/content',
        navLabel: '발행 피드 캘린더에서 확인',
      };

      render(<EvidenceCard evidence={evidence} onNavigate={onNavigate} />);

      expect(screen.getByTestId('event-card-evidence')).toBeDefined();
      expect(screen.getByText('VERIFIED_EVIDENCE')).toBeDefined();
      expect(screen.getByText('151 크레딧 정산')).toBeDefined();
      expect(screen.getByText('INSTAGRAM')).toBeDefined();
      expect(screen.getByText('200 OK')).toBeDefined();

      const navBtn = screen.getByRole('button', { name: /발행 피드 캘린더에서 확인/ });
      fireEvent.click(navBtn);
      expect(onNavigate).toHaveBeenCalledWith('/app/content');
    });
  });

  describe('5. BlockedCard & ResultUnknownCard', () => {
    it('renders BlockedCard with error code, message, and step', () => {
      render(
        <BlockedCard
          errorCode="RATE_LIMIT_EXCEEDED"
          message="광고 플랫폼 API 호출 한도에 도달하여 안전을 위해 중단되었습니다."
          step="ads.dispatch"
        />
      );

      expect(screen.getByTestId('event-card-blocked')).toBeDefined();
      expect(screen.getByText('BLOCKED')).toBeDefined();
      expect(screen.getByText('RATE_LIMIT_EXCEEDED')).toBeDefined();
      expect(screen.getByText(/광고 플랫폼 API 호출 한도에 도달하여/)).toBeDefined();
      expect(screen.getByText('중단 위치: ads.dispatch')).toBeDefined();
    });

    it('renders ResultUnknownCard with waiting guidance', () => {
      render(<ResultUnknownCard message="비동기 승인 결과를 대기하고 있습니다." />);

      expect(screen.getByTestId('event-card-result-unknown')).toBeDefined();
      expect(screen.getByText('결과 확인 중')).toBeDefined();
      expect(screen.queryByText('RESULT_UNKNOWN')).toBeNull();
      expect(screen.getByText('비동기 승인 결과를 대기하고 있습니다.')).toBeDefined();
      expect(screen.getByText(/중복 집행 방지 위해 자동 재시도 금지/)).toBeDefined();
      expect(screen.getByRole('button', { name: /수동 상태 대사/ })).toBeDefined();
      expect(screen.queryByRole('button', { name: /^(다시 시도|재시도|retry)$/i })).toBeNull();
    });
  });
});
