import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniversalAgentDock } from '../universal-agent-dock';
import { SoheeAgentDock } from '../sohee-agent-dock';
import { SurfaceContextProvider } from '@/features/agent-dock/surface-context';
import { ProposalBusProvider } from '@/features/agent-dock/proposal-bus';
import { OwnerException } from '@/features/agent-dock/types';

// Mock useSoheeAutonomy
const mockSetAutonomy = vi.fn();
vi.mock('@/hooks/use-sohee-autonomy', () => ({
  useSoheeAutonomy: () => ({
    isRunning: true,
    actualMode: 'RUNNING',
    killSwitchActive: false,
    isLoading: false,
    setAutonomy: mockSetAutonomy,
  }),
}));

// Mock useCreditBalance
vi.mock('@/hooks/use-credit-balance', () => ({
  useCreditBalance: () => ({
    balance: 84000,
    capacity: 100000,
    remainingPercentage: 84,
  }),
}));

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/app/sohee',
  useSearchParams: () => ({
    get: (key: string) => (key === 'tab' ? 'capabilities' : null),
  }),
}));

describe('UniversalAgentDock Component (ANI-809, Figma 9:703)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          proposals: [],
          messages: [],
          reply: '테스트 응답입니다.',
        }),
      } as any;
    });
  });

  const renderDock = (props = {}) => {
    return render(
      <SurfaceContextProvider>
        <ProposalBusProvider>
          <UniversalAgentDock {...props} />
        </ProposalBusProvider>
      </SurfaceContextProvider>
    );
  };

  it('renders dock header, autonomy control bar, and context badge', () => {
    renderDock();

    expect(screen.getByText('소희 (자율 에이전트)')).toBeDefined();
    expect(screen.getByText(/화면 인지: 나의 소희/)).toBeDefined();
    expect(screen.getByText('현재 상태:')).toBeDefined();
    expect(screen.getByRole('button', { name: /소희 자율근무 일시정지/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /소희 자율근무 재개/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /소희 자율근무 긴급 중단/ })).toBeDefined();
  });

  it('clicking 일시정지 triggers setAutonomy(false)', async () => {
    renderDock();

    const pauseBtn = screen.getByRole('button', { name: /소희 자율근무 일시정지/ });
    fireEvent.click(pauseBtn);

    expect(mockSetAutonomy).toHaveBeenCalledWith(false);
  });

  it('recognizes natural language command "잠깐 멈춰" and executes pause', async () => {
    renderDock();

    const textarea = screen.getByPlaceholderText(/이번 주말 신메뉴 글 올려줘/);
    fireEvent.change(textarea, { target: { value: '잠깐 멈춰' } });

    const submitBtn = screen.getByRole('button', { name: /소희에게 메시지 전송/ });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSetAutonomy).toHaveBeenCalledWith(false);
    });
  });

  it('recognizes natural language command "다시 시작해" and executes resume', async () => {
    renderDock();

    const textarea = screen.getByPlaceholderText(/이번 주말 신메뉴 글 올려줘/);
    fireEvent.change(textarea, { target: { value: '다시 시작해' } });

    const submitBtn = screen.getByRole('button', { name: /소희에게 메시지 전송/ });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSetAutonomy).toHaveBeenCalledWith(true);
    });
  });

  it('채팅 액션은 카드로 표시하고 클릭하기 전에는 초안을 만들지 않는다', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input, init) => ({
      ok: true, status: 200,
      json: async () => init?.method === 'POST' && String(input).endsWith('/agent/chat')
        ? { reply: '초안을 만들까요?', actions: [{ type: 'create_post', topic: '이번 주말 신메뉴' }] }
        : { messages: [], proposals: [] },
    }) as Response);
    renderDock();
    fireEvent.change(screen.getByPlaceholderText(/이번 주말 신메뉴 글 올려줘/), { target: { value: '이번 주말 신메뉴 글 올려줘' } });
    fireEvent.click(screen.getByRole('button', { name: '소희에게 메시지 전송' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '이 주제로 초안 만들기' })).toBeDefined());
    const draftCalls = vi.mocked(global.fetch).mock.calls.filter(([url]) => String(url).endsWith('/quick-post'));
    expect(draftCalls).toHaveLength(0);
    expect(vi.mocked(global.fetch).mock.calls.find(([url]) => String(url).endsWith('/agent/chat'))?.[1]?.body).toContain('"dockIntent":true');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('앱 셸에서 사용하는 Sohee Dock도 액션 카드만 제안하며 자동 발행하지 않는다', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input, init) => ({
      ok: true, status: 200,
      json: async () => init?.method === 'POST' && String(input).endsWith('/agent/chat')
        ? { reply: '콘텐츠에서 승인해 주세요.', actions: [{ type: 'open_content' }] }
        : { messages: [], proposals: [] },
    }) as Response);
    render(
      <SurfaceContextProvider>
        <ProposalBusProvider>
          <SoheeAgentDock workspaceId="ws-1" />
        </ProposalBusProvider>
      </SurfaceContextProvider>
    );
    fireEvent.change(screen.getByPlaceholderText(/이번 주말 신메뉴 글 올려줘/), { target: { value: '이 게시물 지금 발행해줘' } });
    fireEvent.click(screen.getByRole('button', { name: '소희에게 메시지 전송' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '콘텐츠에서 확인하기' })).toBeDefined());
    expect(vi.mocked(global.fetch).mock.calls.filter(([url]) => String(url).includes('publish'))).toHaveLength(0);
    expect(mockPush).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '콘텐츠에서 확인하기' }));
    expect(mockPush).toHaveBeenCalledWith('/app/content');
  });

  it('실패 안내의 세 추천 질문은 버튼으로 보이고 입력창에 옮겨지며 마크다운 원문은 노출하지 않는다', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input, init) => ({
      ok: true, status: 200,
      json: async () => init?.method === 'POST' && String(input).endsWith('/agent/chat')
        ? { reply: '**소희가 할 수 있는 일**\n- 초안 제안', fallback: true, suggestedQuestions: ['첫 질문', '둘째 질문', '셋째 질문'] }
        : { messages: [], proposals: [] },
    }) as Response);
    const { container } = renderDock();
    fireEvent.change(screen.getByPlaceholderText(/이번 주말 신메뉴 글 올려줘/), { target: { value: '안녕' } });
    fireEvent.click(screen.getByRole('button', { name: '소희에게 메시지 전송' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '첫 질문' })).toBeDefined());
    expect(container.querySelector('strong')?.textContent).toBe('소희가 할 수 있는 일');
    expect(container.querySelector('li')?.textContent).toBe('초안 제안');
    expect(container.textContent).not.toContain('**');
    expect(screen.getAllByRole('button', { name: /질문/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '둘째 질문' }));
    expect((screen.getByPlaceholderText(/이번 주말 신메뉴 글 올려줘/) as HTMLTextAreaElement).value).toBe('둘째 질문');
  });

  it('renders exception card and handles proposal approval via ProposalBus', async () => {
    const mockException: OwnerException = {
      id: 'ex-1',
      title: '시술 사진 추가 승인 필요',
      description: '블로그 가이드라인에 맞춰 시술 사진 최소 3장을 업로드할 것을 제안합니다.',
      severity: 'WARNING',
      category: 'TONE_CHECK',
      createdAt: new Date().toISOString(),
      proposal: {
        id: 'prop-1',
        type: 'RULE_UPDATE',
        title: '시술 사진 3장 필수 지침',
        description: '블로그 발행 시 실제 시술 전후 사진을 3장 이상 첨부하도록 지침을 수정합니다.',
        proposedValue: 3,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      },
    };

    renderDock({ pendingExceptions: [mockException] });

    expect(screen.getByText('사장님 확인 필요')).toBeDefined();
    expect(screen.getByText('시술 사진 추가 승인 필요')).toBeDefined();
    expect(screen.getByText('답변하고 중앙 설정에 반영')).toBeDefined();

    const approveBtn = screen.getByText('답변하고 중앙 설정에 반영');
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(screen.getByText('중앙 설정 및 규칙에 반영 완료됨')).toBeDefined();
    });
  });
});
