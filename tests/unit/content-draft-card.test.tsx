import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentDraftCard, type ContentDraftCardData } from '@/components/agent-dock/content-draft-card';

describe('ContentDraftCard Component', () => {
  const WORKSPACE_ID = 'ws-test-card';
  const mockCardData: ContentDraftCardData = {
    draftId: 'draft-uuid-1',
    topic: '가을 시그니처 뷰티 케어',
    variants: [
      {
        channel: 'instagram',
        status: 'NEEDS_FIX',
        statusLabel: '수정이 필요해요',
        issues: ['인스타그램 게시를 위해 이미지가 최소 1장 이상 필요해요.'],
        contentId: 'cid-ig-1',
        versionId: 'vid-ig-1',
        vaultSavable: false,
        caption: '인스타그램 가을 맞이 뷰티 케어 안내 피드입니다.',
        hashtags: ['#가을뷰티', '#청라케어'],
      },
      {
        channel: 'threads',
        status: 'READY',
        statusLabel: '보관할 수 있어요',
        issues: [],
        contentId: 'cid-th-1',
        versionId: 'vid-th-1',
        vaultSavable: true,
        caption: '스레드 이웃 여러분! 가을 맞이 뷰티 소식을 전해드려요.',
        hashtags: ['#스레드소식'],
      },
      {
        channel: 'naver_blog',
        status: 'READY',
        statusLabel: '보관할 수 있어요',
        issues: [],
        contentId: 'cid-nb-1',
        versionId: 'vid-nb-1',
        vaultSavable: true,
        title: '청라 뷰티 케어 전문 바이름 가을 스토리',
        caption: '네이버 블로그 이웃님들 안녕하세요. 오늘은 가을 케어를 소개해 드립니다.',
        hashtags: ['#청라네이버블로그'],
      },
      {
        channel: 'daangn_business',
        status: 'READY',
        statusLabel: '보관할 수 있어요',
        issues: [],
        contentId: 'cid-dg-1',
        versionId: 'vid-dg-1',
        vaultSavable: true,
        title: '우리 동네 이웃님을 위한 가을 혜택',
        caption: '당근 단골 이웃님들을 위한 특별 케어 소식입니다.',
        hashtags: ['#당근소식'],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('일반 원고를 대화 안에서 수정하고 새 버전을 읽어 확인한 뒤 보관한다', async () => {
    let revised = false;
    const writes: Array<{ url: string; body: any }> = [];
    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (init?.method === 'POST') {
        writes.push({ url, body: JSON.parse(String(init.body)) });
        if (url.endsWith('/revisions')) {
          revised = true;
          return { ok: true, json: async () => ({ success: true, content: { contentId: 'cid-th-1', versionId: 'vid-th-2', fingerprint: 'a'.repeat(64), status: 'draft' } }) } as Response;
        }
        return { ok: true, json: async () => ({ success: true, external_posts: 0 }) } as Response;
      }
      return { ok: true, json: async () => ({ success: true, contents: [{
        workspaceId: WORKSPACE_ID, contentId: 'cid-th-1', channel: 'threads',
        currentVersionId: revised ? 'vid-th-2' : 'vid-th-1',
        caption: revised ? '직접 수정한 일반 원고' : mockCardData.variants[1].caption,
        hashtags: ['#스레드소식'], mediaUrls: ['/workspace-photo'], fingerprint: 'a'.repeat(64),
      }] }) } as Response;
    });
    render(<ContentDraftCard card={mockCardData} workspaceId={WORKSPACE_ID} />);
    fireEvent.click(screen.getByRole('tab', { name: /스레드/i }));
    fireEvent.click(screen.getByRole('button', { name: '원고 수정하기' }));
    const input = await screen.findByRole('textbox', { name: '원고 본문' });
    fireEvent.change(input, { target: { value: '직접 수정한 일반 원고' } });
    expect(screen.getByRole('button', { name: '보관함에 담기' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '수정 내용 저장하기' }));
    await screen.findByText(/원고를 저장했어요/);
    expect(writes[0]).toEqual({
      url: `/api/workspaces/${WORKSPACE_ID}/content/cid-th-1/revisions`,
      body: { expectedVersionId: 'vid-th-1', caption: '직접 수정한 일반 원고' },
    });
    fireEvent.click(screen.getByRole('button', { name: '보관함에 담기' }));
    await screen.findByText('보관함 저장 완료');
    expect(writes[1].body.versionId).toBe('vid-th-2');
    expect(writes.some(write => /approve|publish/.test(write.url))).toBe(false);
  });

  it.each([false, true])('미션에 묶인 최신 원고 검토만 표시하고 비용 미확인 승인 요청은 보내지 않는다 (버전 불일치: %s)', async (stale) => {
    const calls: Array<{ url: string; method: string }> = [];
    global.fetch = vi.fn(async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' });
      return { ok: true, json: async () => ({
        workspaceId: WORKSPACE_ID, missionId: 'mission-1', runId: 'run-1',
        artifactReview: {
          preview: { workspaceId: WORKSPACE_ID, contentId: 'cid-ig-1', versionId: stale ? 'other-version' : 'vid-ig-1',
            versionNumber: 1, fingerprint: 'a'.repeat(64), channel: 'instagram', visibility: null,
            approval: { id: null, status: 'unreviewed', fingerprint: null },
            account: { connectionId: 'connection-1', label: '@real-shop', status: 'connected' },
            caption: mockCardData.variants[0].caption, hashtags: ['#가을뷰티', '#청라케어'], disclosure: 'AI 보조 제작', text: '서버가 확인한 게시 원고',
            media: [{ id: 'photo-1', position: 1, mimeType: 'image/jpeg', altText: '사용권 검토가 필요한 매장 사진', src: '/api/workspaces/ws-test-card/media/photo-1', width: 1080, height: 1350, sizeBytes: 240000 }], issues: [],
          },
          cost: { state: 'UNKNOWN' }, approvalAllowed: false, blockers: ['게시 비용과 승인 범위를 아직 확인하지 못했습니다.'],
        },
      }) } as Response;
    });
    render(<ContentDraftCard card={mockCardData} workspaceId={WORKSPACE_ID} missionId="mission-1" runId="run-1" />);
    fireEvent.click(screen.getByRole('button', { name: '원고·사진·승인 조건 확인' }));
    if (stale) {
      await screen.findByRole('alert');
      expect(screen.queryByText('@real-shop')).not.toBeInTheDocument();
    } else {
      await screen.findByText('@real-shop');
      expect(screen.getByText('서버가 확인한 게시 원고')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: '사용권 검토가 필요한 매장 사진' })).toBeInTheDocument();
      expect(screen.getByText('게시 비용과 승인 범위를 아직 확인하지 못했습니다.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '승인 조건 확인 필요' })).toBeDisabled();
    }
    const url = new URL(calls[0].url, 'http://localhost');
    expect(Object.fromEntries(url.searchParams)).toEqual({ missionId: 'mission-1', runId: 'run-1', contentId: 'cid-ig-1', versionId: 'vid-ig-1' });
    expect(calls.every(call => call.method === 'GET')).toBe(true);
  });

  it.each(['workspace', 'mission', 'run', 'content'])('검토 응답의 %s 범위가 다르면 다른 계정과 원고를 표시하지 않는다', async (mismatch) => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({
      workspaceId: mismatch === 'workspace' ? 'other-workspace' : WORKSPACE_ID,
      missionId: mismatch === 'mission' ? 'other-mission' : 'mission-1',
      runId: mismatch === 'run' ? 'other-run' : 'run-1',
      artifactReview: { preview: { workspaceId: WORKSPACE_ID, contentId: mismatch === 'content' ? 'other-content' : 'cid-ig-1', versionId: 'vid-ig-1', account: { label: '@wrong-scope' }, text: '다른 범위의 원고', media: [] }, cost: { state: 'UNKNOWN' }, approvalAllowed: false, blockers: ['승인 범위 확인 필요'] },
    }) }) as Response);
    render(<ContentDraftCard card={mockCardData} workspaceId={WORKSPACE_ID} missionId="mission-1" runId="run-1" />);
    fireEvent.click(screen.getByRole('button', { name: '원고·사진·승인 조건 확인' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('@wrong-scope')).not.toBeInTheDocument();
  });

  it('불완전한 검토 응답을 승인 조건으로 표시하지 않고 재조회할 수 있다', async () => {
    global.fetch = vi.fn(async () => Response.json({
      workspaceId: WORKSPACE_ID, missionId: 'mission-1', runId: 'run-1',
      artifactReview: { preview: { workspaceId: WORKSPACE_ID, contentId: 'cid-ig-1', versionId: 'vid-ig-1', account: { label: '@incomplete' }, text: '일부 원고', media: null }, cost: { state: 'UNKNOWN' }, approvalAllowed: false, blockers: [] },
    }));
    render(<ContentDraftCard card={mockCardData} workspaceId={WORKSPACE_ID} missionId="mission-1" runId="run-1" />);
    fireEvent.click(screen.getByRole('button', { name: '원고·사진·승인 조건 확인' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('@incomplete')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '원고·사진·승인 조건 확인' })).toBeEnabled();
  });

  it('미션 전환 전에 시작한 검토 응답이 늦게 도착해도 새 미션에 표시하지 않는다', async () => {
    let finishReview!: (response: Response) => void;
    global.fetch = vi.fn(() => new Promise<Response>(resolve => { finishReview = resolve; }));
    const { rerender } = render(<ContentDraftCard card={mockCardData} workspaceId={WORKSPACE_ID} missionId="mission-1" runId="run-1" />);
    fireEvent.click(screen.getByRole('button', { name: '원고·사진·승인 조건 확인' }));
    rerender(<ContentDraftCard card={mockCardData} workspaceId={WORKSPACE_ID} missionId="mission-2" runId="run-2" />);
    finishReview({ ok: true, json: async () => ({
      workspaceId: WORKSPACE_ID, missionId: 'mission-1', runId: 'run-1',
      artifactReview: { preview: { workspaceId: WORKSPACE_ID, contentId: 'cid-ig-1', versionId: 'vid-ig-1', account: { label: '@previous-mission' }, text: '이전 미션 원고', media: [] }, cost: { state: 'UNKNOWN' }, approvalAllowed: false, blockers: ['승인 범위 확인 필요'] },
    }) } as Response);
    await waitFor(() => expect(screen.getByRole('button', { name: '원고·사진·승인 조건 확인' })).toBeEnabled());
    expect(screen.queryByText('@previous-mission')).not.toBeInTheDocument();
  });

  it('일반 원고 저장이 충돌하면 입력을 유지하고 보관을 막는다', async () => {
    global.fetch = vi.fn(async (_input, init) => init?.method === 'POST'
      ? { ok: false, status: 409, json: async () => ({ success: false }) } as Response
      : { ok: true, json: async () => ({ success: true, contents: [{
        workspaceId: WORKSPACE_ID, contentId: 'cid-th-1', channel: 'threads', currentVersionId: 'vid-th-1', caption: '원본', hashtags: [],
      }] }) } as Response);
    render(<ContentDraftCard card={mockCardData} workspaceId={WORKSPACE_ID} />);
    fireEvent.click(screen.getByRole('tab', { name: /스레드/i }));
    fireEvent.click(screen.getByRole('button', { name: '원고 수정하기' }));
    fireEvent.change(await screen.findByRole('textbox', { name: '원고 본문' }), { target: { value: '유지할 입력' } });
    fireEvent.click(screen.getByRole('button', { name: '수정 내용 저장하기' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('textbox', { name: '원고 본문' })).toHaveValue('유지할 입력');
    expect(screen.getByRole('button', { name: '보관함에 담기' })).toBeDisabled();
  });

  it('기본으로 인스타그램 탭이 선택되어 원고와 상태가 표시된다', () => {
    render(<ContentDraftCard card={mockCardData} workspaceId={WORKSPACE_ID} />);

    expect(screen.getByText('가을 시그니처 뷰티 케어')).toBeDefined();
    expect(screen.getByText(/인스타그램 가을 맞이 뷰티 케어 안내 피드입니다/)).toBeDefined();
    expect(screen.getByText(/#가을뷰티/)).toBeDefined();
    expect(screen.getByText(/수정이 필요해요/)).toBeDefined();
  });

  it('다른 채널 탭(스레드, 네이버 블로그) 클릭 시 해당 채널 원고로 전환된다', () => {
    render(<ContentDraftCard card={mockCardData} workspaceId={WORKSPACE_ID} />);

    // 스레드 탭 클릭
    const threadsTab = screen.getByRole('tab', { name: /스레드/i });
    fireEvent.click(threadsTab);

    expect(screen.getByText(/스레드 이웃 여러분!/)).toBeDefined();
    expect(screen.getByText(/#스레드소식/)).toBeDefined();

    // 네이버 블로그 탭 클릭
    const blogTab = screen.getByRole('tab', { name: /네이버 블로그/i });
    fireEvent.click(blogTab);

    expect(screen.getByText('청라 뷰티 케어 전문 바이름 가을 스토리')).toBeDefined();
    expect(screen.getByText(/네이버 블로그 이웃님들 안녕하세요/)).toBeDefined();
  });

  it('보관 가능한 채널(스레드)에서 [보관함에 담기] 클릭 시 /api/workspaces/[ws]/vault로 POST 요청이 가고 완료 뱃지가 뜬다', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, external_posts: 0 }),
    });
    global.fetch = fetchSpy as any;

    render(<ContentDraftCard card={mockCardData} workspaceId={WORKSPACE_ID} />);

    // 스레드 탭으로 전환 (vaultSavable: true)
    fireEvent.click(screen.getByRole('tab', { name: /스레드/i }));

    const saveBtn = screen.getByRole('button', { name: /보관함에 담기/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/workspaces/${WORKSPACE_ID}/vault`,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"contentId":"cid-th-1"'),
        })
      );
      expect(screen.getByText(/보관함 저장 완료/i)).toBeDefined();
    });
  });
});
