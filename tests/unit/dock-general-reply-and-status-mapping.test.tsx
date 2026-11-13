import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ExecutionCard,
  mapActionRunStatusToKorean,
} from '@/features/action-graph/event-cards';
import { SoheeAgentDock } from '@/components/agent-dock/sohee-agent-dock';

vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
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
    sessionId: 'sess-test',
    threadId: 'th-test',
    isLoading: false,
  }),
}));

describe('결함 3 검증: 내부 용어 노출 차단 및 GENERAL_REPLY 시 작업 카드 미노출', () => {
  describe('1. 상태 라벨 한국어 매핑 (mapActionRunStatusToKorean)', () => {
    it('모든 ActionRun 상태 코드를 사용자용 한국어로 정확히 매핑한다', () => {
      expect(mapActionRunStatusToKorean('COMPLETED')).toBe('완료');
      expect(mapActionRunStatusToKorean('MCP_TOOL_EXECUTED')).toBe('완료');
      expect(mapActionRunStatusToKorean('CONTENT_PREVIEW')).toBe('미리보기 준비됨');
      expect(mapActionRunStatusToKorean('INTERVIEW_QUESTION')).toBe('질문 드리는 중');
      expect(mapActionRunStatusToKorean('RUNNING')).toBe('진행 중');
      expect(mapActionRunStatusToKorean('EXECUTING')).toBe('진행 중');
      expect(mapActionRunStatusToKorean('AWAITING_APPROVAL')).toBe('승인 기다리는 중');
      expect(mapActionRunStatusToKorean('BLOCKED')).toBe('멈춤');
      expect(mapActionRunStatusToKorean('FAILED')).toBe('실패');
      expect(mapActionRunStatusToKorean('ERROR')).toBe('실패');
      expect(mapActionRunStatusToKorean('PLANNING')).toBe('계획 중');
      expect(mapActionRunStatusToKorean('SOME_UNKNOWN_CODE')).toBe('확인 중');
      expect(mapActionRunStatusToKorean(undefined)).toBe('확인 중');
    });
  });

  describe('2. ExecutionCard 한국어 매핑 및 내부 로그/UUID 숨김', () => {
    it('상태 라벨을 한국어로 표시하고 내부 로그성 줄과 UUID를 제거한다', () => {
      render(
        <ExecutionCard
          card={{
            planId: 'plan-test-1',
            status: 'COMPLETED',
            currentStepName: '콘텐츠 보관 완료',
            progressPercentage: 100,
            logs: [
              '[Iteration 1] 추가 도구 호출 없이 목표 완료 계약 충족',
              '실행 모드: DRAFT',
              'UUID: 123e4567-e89b-12d3-a456-426614174000',
              '정상적으로 게시물이 보관함에 저장되었습니다.',
            ],
          }}
        />
      );

      // 한국어 상태 라벨 노출 확인
      expect(screen.getByText('완료')).toBeDefined();
      expect(screen.queryByText('COMPLETED')).toBeNull();

      // 사용자 친화적 로그는 노출
      expect(screen.getByText(/정상적으로 게시물이 보관함에 저장되었습니다/)).toBeDefined();

      // 내부 로그성 줄 및 UUID는 화면에서 제거
      expect(screen.queryByText(/\[Iteration 1\]/)).toBeNull();
      expect(screen.queryByText(/실행 모드/)).toBeNull();
      expect(screen.queryByText(/123e4567-e89b/)).toBeNull();
    });
  });

  describe('3. SoheeAgentDock: GENERAL_REPLY 시 진행 바 및 ExecutionCard 미노출', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('GENERAL_REPLY 응답 시 상단 진행 중인 작업 바와 ExecutionCard가 나타나지 않는다', async () => {
      global.fetch = vi.fn().mockImplementation(async (_url, options) => ({
        ok: true,
        status: 200,
        json: async () =>
          options?.method === 'POST'
            ? {
                reply: '사장님, 궁금하신 점에 대해 답변해 드립니다.',
                runId: 'run-gen-123',
                step: 'GENERAL_REPLY',
                liveExecutionCard: {
                  status: 'COMPLETED',
                  progressPercentage: 100,
                  currentStepName: '답변 작성 완료',
                },
              }
            : { success: true, messages: [] },
      })) as any;

      render(<SoheeAgentDock isOpen={true} workspaceId="ws-test" />);

      fireEvent.change(screen.getByPlaceholderText(/예: 이번 주말 신메뉴 글 올려줘/i), {
        target: { value: '오늘 날씨 어때?' },
      });
      fireEvent.click(screen.getByRole('button', { name: '소희에게 메시지 전송' }));

      await waitFor(() => {
        expect(screen.getByText('사장님, 궁금하신 점에 대해 답변해 드립니다.')).toBeDefined();
      });

      // GENERAL_REPLY 이므로 '진행 중인 작업' 바와 ExecutionCard가 노출되지 않아야 함
      expect(screen.queryByText('진행 중인 작업')).toBeNull();
      expect(screen.queryByTestId('event-card-execution')).toBeNull();
    });

    it.each([
      ['RUNNING', '진행 중'],
      ['AWAITING_APPROVAL', '승인 기다리는 중'],
      ['COMPLETED', '완료'],
      ['MCP_TOOL_EXECUTED', '완료'],
      ['CONTENT_PREVIEW', '미리보기 준비됨'],
      ['INTERVIEW_QUESTION', '질문 드리는 중'],
      ['ERROR', '실패'],
    ])('실제 작업 응답(step=%s)이면 상단 바 상태가 "%s"로 정확히 표시된다 (이중 매핑 금지)', async (step, label) => {
      global.fetch = vi.fn().mockImplementation(async (_url, options) => ({
        ok: true,
        status: 200,
        json: async () =>
          options?.method === 'POST'
            ? { reply: '작업을 시작했어요.', runId: 'run-task-1', step }
            : { success: true, messages: [] },
      })) as any;

      render(<SoheeAgentDock isOpen={true} workspaceId="ws-test" />);
      fireEvent.change(screen.getByPlaceholderText(/예: 이번 주말 신메뉴 글 올려줘/i), {
        target: { value: '이번 주말 신메뉴 글 올려줘' },
      });
      fireEvent.click(screen.getByRole('button', { name: '소희에게 메시지 전송' }));

      await waitFor(() => expect(screen.getByText('작업을 시작했어요.')).toBeDefined());
      const bar = screen.getByTestId('active-run-bar');
      expect(bar.textContent).toContain(label);
      expect(bar.textContent).not.toContain('확인 중');
      expect(bar.textContent).not.toContain(step);
    });
  });
});
