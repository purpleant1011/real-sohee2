import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ProposalBusProvider,
  approvalWriteKind,
  useProposalBus,
  type ProposalBusValue,
} from '../proposal-bus';
import { DUPLICATE_WRITE_COPY, OFFLINE_WRITE_COPY } from '@/features/pwa/action-guard';
import { resetPageActionGuardForTests } from '@/features/pwa/external-write';

const PENDING_APPROVAL = {
  proposalId: 'prop-1',
  proposalType: 'DM_SEND_APPROVAL',
  title: '답장을 보낼까요?',
  description: '고객에게 답장을 보냅니다.',
  proposedValue: { threadKey: 'dm:1', body: '네, 가능합니다.' },
  status: 'PENDING',
  createdAt: '2026-10-24T00:00:00.000Z',
  version: 3,
};

type BusRef = { current: ProposalBusValue | null };

function makeCapture(): { ref: BusRef; Capture: () => null } {
  const ref: BusRef = { current: null };
  function Capture() {
    ref.current = useProposalBus() as ProposalBusValue;
    return null;
  }
  return { ref, Capture };
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

function approvalCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      String(input).includes('/agent/approvals') &&
      (init as RequestInit | undefined)?.method === 'POST',
  );
}

function baseFetch(postImpl: (init?: RequestInit) => Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/manifest.webmanifest')) return jsonResponse({});
    if (url.includes('/agent/approvals') && init?.method === 'POST') return postImpl(init);
    if (url.includes('/agent/approvals')) {
      return jsonResponse({ success: true, approvals: [PENDING_APPROVAL] });
    }
    return jsonResponse({});
  });
}

async function mountBus(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  const { ref, Capture } = makeCapture();
  render(
    <ProposalBusProvider workspaceId="ws-1">
      <Capture />
    </ProposalBusProvider>,
  );
  await waitFor(() => expect(ref.current?.activeProposals).toHaveLength(1));
  return ref;
}

describe('agent-dock approval external-write guard (ANI-1778)', () => {
  beforeEach(() => {
    resetPageActionGuardForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('오프라인이면 승인 요청을 내보내지 않고 안내한다', async () => {
    const fetchMock = baseFetch(async () => jsonResponse({ success: true }));
    const bus = await mountBus(fetchMock);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    const run = bus.current!.acceptProposal('prop-1', 3);

    await waitFor(() => expect(bus.current!.lastError).toBe(OFFLINE_WRITE_COPY));
    expect(await run).toBe(false);
    expect(approvalCalls(fetchMock)).toHaveLength(0);
  });

  it('중복 클릭에도 승인 요청은 한 번만 나간다', async () => {
    let release!: (res: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = baseFetch(() => pending);
    const bus = await mountBus(fetchMock);

    const first = bus.current!.acceptProposal('prop-1', 3);
    const second = bus.current!.acceptProposal('prop-1', 3);

    await waitFor(() => expect(approvalCalls(fetchMock)).toHaveLength(1));
    release(jsonResponse({ success: true }));

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
    await waitFor(() => expect(bus.current!.lastError).toBe(DUPLICATE_WRITE_COPY));
    expect(approvalCalls(fetchMock)).toHaveLength(1);
  });

  it('서버 승인 버전을 expectedVersion 으로 보낸다', async () => {
    const fetchMock = baseFetch(async () => jsonResponse({ success: true }));
    const bus = await mountBus(fetchMock);

    const run = bus.current!.acceptProposal('prop-1', 3);
    await waitFor(() => expect(approvalCalls(fetchMock)).toHaveLength(1));
    await expect(run).resolves.toBe(true);

    const [call] = approvalCalls(fetchMock);
    const body = JSON.parse(String((call[1] as RequestInit).body));
    expect(body).toMatchObject({ proposalId: 'prop-1', action: 'APPROVE', expectedVersion: 3 });
  });

  it('getProposal 에 서버 버전과 승인 유형을 보존한다', async () => {
    const fetchMock = baseFetch(async () => jsonResponse({ success: true }));
    const bus = await mountBus(fetchMock);

    const proposal = bus.current!.getProposal('prop-1');
    expect(proposal?.version).toBe(3);
    // 승인 유형은 실행될 외부 쓰기 종류를 가른다(DM 은 send).
    expect(approvalWriteKind(proposal?.approvalType)).toBe('send');
    expect(approvalWriteKind('RESERVATION_CONFIRMATION')).toBe('reservation');
    expect(approvalWriteKind('PUBLISH_APPROVAL')).toBe('publish');
  });
});
