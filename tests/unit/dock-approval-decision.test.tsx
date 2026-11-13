import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('SoheeAgentDock Approval Decision Wiring', () => {
  const WORKSPACE_ID = 'ws-test-appr';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ApprovalCard의 승인 버튼 클릭 시 /api/workspaces/[ws]/agent/approvals로 POST 요청을 보내고 승인 메시지를 출력한다', async () => {
    const fetchSpy = vi.fn().mockImplementation(async (url: string, options?: any) => {
      if (options?.method === 'POST') {
        if (url.includes('/agent/chat')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              reply: '승인 요청 카드가 준비되었습니다.',
              runId: 'run-appr-1',
              step: 'AWAITING_APPROVAL',
              approvalCard: {
                decisionId: 'prop-xyz-1',
                title: '인스타그램 게시물 발행 승인',
                options: [
                  { id: 'approve', label: '승인 및 실행', description: '공식 채널에 게시합니다.' },
                  { id: 'reject', label: '취소' },
                ],
              },
            }),
          };
        }
        if (url.includes('/agent/approvals')) {
          const body = JSON.parse(options.body || '{}');
          expect(body.proposalId).toBe('prop-xyz-1');
          expect(body.action).toBe('APPROVE');
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              status: 'COMPLETED',
              approval: { proposalId: 'prop-xyz-1', status: 'APPROVED' },
            }),
          };
        }
      }
      return { ok: true, status: 200, json: async () => ({ success: true, messages: [] }) };
    });

    global.fetch = fetchSpy as any;

    render(<SoheeAgentDock isOpen={true} workspaceId={WORKSPACE_ID} />);

    // 1. 메시지 전송으로 승인 카드 유도
    fireEvent.change(screen.getByPlaceholderText(/예: 이번 주말 신메뉴 글 올려줘/i), {
      target: { value: '글 발행해줘' },
    });
    fireEvent.click(screen.getByRole('button', { name: '소희에게 메시지 전송' }));

    await waitFor(() => {
      expect(screen.getByText('인스타그램 게시물 발행 승인')).toBeDefined();
    });

    // 2. 승인 버튼 클릭
    const approveBtn = screen.getByRole('button', { name: /승인 및 실행/i });
    fireEvent.click(approveBtn);

    // 3. /agent/approvals 호출 및 메시지 노출 검증
    await waitFor(() => {
      const calls = fetchSpy.mock.calls.map((c) => c[0]);
      expect(calls.some((url: string) => url.includes('/agent/approvals'))).toBe(true);
      expect(screen.getByText('승인이 기록되었습니다. 실행 결과는 별도로 확인해야 합니다.')).toBeInTheDocument();
      expect(screen.queryByText(/승인이 확인되어/)).not.toBeInTheDocument();
    });
  });

  it('일반 원고 수정 요청 후 저장 결과가 미확인이어도 같은 미션의 이전 승인 버튼을 숨긴다', async () => {
    const writes: string[] = [];
    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (init?.method === 'POST') {
        writes.push(url);
        if (url.endsWith('/agent/chat')) return { ok: true, json: async () => ({
          reply: '검토할 원고입니다.', missionId: 'mission-a', runId: 'run-a', step: 'AWAITING_APPROVAL',
          draftId: 'draft-a', topic: '소식', variants: [{ channel: 'threads', contentId: 'content-a', versionId: 'version-1', caption: '원본', hashtags: [], status: 'READY', statusLabel: '보관 가능', issues: [], vaultSavable: true }],
          approvalCard: { decisionId: 'decision-a', title: '기존 원고 승인', options: [{ id: 'approve', label: '기존 승인 실행' }] },
        }) } as Response;
        if (url.endsWith('/revisions')) return { ok: false, status: 409, json: async () => ({ success: false, error: { code: 'REVISION_RECONCILIATION_REQUIRED' } }) } as Response;
      }
      if (url.endsWith('/content')) return { ok: true, json: async () => ({ success: true, contents: [{ workspaceId: WORKSPACE_ID, contentId: 'content-a', channel: 'threads', currentVersionId: 'version-1', caption: '원본', hashtags: [] }] }) } as Response;
      return { ok: true, json: async () => ({ success: true, messages: [] }) } as Response;
    });
    render(<SoheeAgentDock isOpen workspaceId={WORKSPACE_ID} />);
    fireEvent.change(screen.getByPlaceholderText(/예: 이번 주말 신메뉴 글 올려줘/i), { target: { value: '원고 준비' } });
    fireEvent.click(screen.getByRole('button', { name: '소희에게 메시지 전송' }));
    await screen.findByRole('button', { name: '원고 수정하기' });
    expect(screen.queryByRole('button', { name: '승인 및 실행' })).not.toBeInTheDocument();
    expect(screen.getByText('원고·사진·계정·비용의 정확한 승인 조건을 먼저 확인해야 합니다.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '원고 수정하기' }));
    fireEvent.change(await screen.findByRole('textbox', { name: '원고 본문' }), { target: { value: '바꾼 원고' } });
    fireEvent.click(screen.getByRole('button', { name: '수정 내용 저장하기' }));
    await screen.findByText(/수정 내용을 확인하지 못했어요/);
    expect(screen.queryByRole('button', { name: '승인 및 실행' })).not.toBeInTheDocument();
    expect(screen.getByText(/초안이 변경되어 이전 승인을 사용할 수 없습니다/)).toBeInTheDocument();
    expect(writes.filter(url => /approvals|publish/.test(url))).toEqual([]);
  });

  it('ApprovalCard의 반려 버튼 클릭 시 /api/workspaces/[ws]/agent/approvals로 REJECT 액션을 전송한다', async () => {
    const fetchSpy = vi.fn().mockImplementation(async (url: string, options?: any) => {
      if (options?.method === 'POST') {
        if (url.includes('/agent/chat')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              reply: '승인 요청 카드가 준비되었습니다.',
              runId: 'run-appr-2',
              step: 'AWAITING_APPROVAL',
              approvalCard: {
                decisionId: 'prop-xyz-2',
                title: '광고 캠페인 생성 승인',
                options: [
                  { id: 'approve', label: '승인 및 실행' },
                  { id: 'reject', label: '반려' },
                ],
              },
            }),
          };
        }
        if (url.includes('/agent/approvals')) {
          const body = JSON.parse(options.body || '{}');
          expect(body.proposalId).toBe('prop-xyz-2');
          expect(body.action).toBe('REJECT');
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              status: 'REJECTED',
              approval: { proposalId: 'prop-xyz-2', status: 'REJECTED' },
            }),
          };
        }
      }
      return { ok: true, status: 200, json: async () => ({ success: true, messages: [] }) };
    });

    global.fetch = fetchSpy as any;

    render(<SoheeAgentDock isOpen={true} workspaceId={WORKSPACE_ID} />);

    // 1. 메시지 전송으로 승인 카드 유도
    fireEvent.change(screen.getByPlaceholderText(/예: 이번 주말 신메뉴 글 올려줘/i), {
      target: { value: '캠페인 만들어줘' },
    });
    fireEvent.click(screen.getByRole('button', { name: '소희에게 메시지 전송' }));

    await waitFor(() => {
      expect(screen.getByText('광고 캠페인 생성 승인')).toBeDefined();
    });

    // 2. 반려 버튼 클릭
    const rejectBtn = screen.getByRole('button', { name: /반려/i });
    fireEvent.click(rejectBtn);

    // 3. /agent/approvals 호출 및 메시지 노출 검증
    await waitFor(() => {
      const calls = fetchSpy.mock.calls.map((c) => c[0]);
      expect(calls.some((url: string) => url.includes('/agent/approvals'))).toBe(true);
      expect(screen.getByText('반려가 기록되었습니다. (진행 중인 작업은 안전하게 마무리돼요)')).toBeInTheDocument();
      expect(screen.queryByText(/사장님의 거절에 따라/)).not.toBeInTheDocument();
    });
  });
});
