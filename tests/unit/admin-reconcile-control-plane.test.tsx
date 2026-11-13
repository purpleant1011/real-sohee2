import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperatorAnyScope: vi.fn(async () => ({
    userId: '10000000-0000-4000-8000-000000000001',
    permissionScopes: [{ permission: 'agent.read', workspaceScope: 'all' }],
  })),
}));

import {
  ExceptionReconcileQueue,
  ExceptionQueueItem,
} from '@/components/admin/exception-reconcile-queue';
import {
  ActionRunInspector,
  ActionRunLineage,
} from '@/components/admin/action-run-inspector';
import { AgentsView } from '@/features/operator-agents/agents-view';
import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator';

describe('ANI-987: Admin Exception & Reconcile Control Plane', () => {
  describe('1. ExceptionReconcileQueue (ANI-987 Acceptance Criteria 1)', () => {
    const mockExceptions: ExceptionQueueItem[] = [
      {
        id: 'exc-001',
        actionRunId: 'act-run-unknown-101',
        workspaceId: 'ws-gangnam-01',
        workspaceName: '강남 피부과',
        channel: 'INSTAGRAM',
        capabilityId: 'mcp_post_instagram_carousel',
        type: 'RESULT_UNKNOWN',
        title: '인스타그램 피드 발행 후 타임아웃 (RESULT_UNKNOWN)',
        detail: '외부 Meta Graph API 504 Gateway Timeout 발생. 이중 포스팅 위험으로 Blind Retry는 차단되었으며, 독립 Readback 대사가 필요합니다.',
        occurredAt: '2026-09-07T03:15:00Z',
        status: 'PENDING_RECONCILE',
        reconcileActionLabel: '독립 Readback 안전 대사 (Reconcile)',
      },
      {
        id: 'exc-002',
        actionRunId: 'act-run-unprobed-102',
        workspaceId: 'ws-seocho-02',
        workspaceName: '서초 클리닉',
        channel: 'NAVER_BLOG',
        capabilityId: 'mcp_post_naver_blog',
        type: 'PROVIDER_UNPROBED',
        title: '네이버 블로그 세션 상태 미확인 (PROVIDER_UNPROBED)',
        detail: '스마트에디터 세션 핑 실패. 작업 디스패치 전 사전 상태 Probe 대사가 필요합니다.',
        occurredAt: '2026-09-07T03:18:00Z',
        status: 'PENDING_RECONCILE',
        reconcileActionLabel: '프로바이더 상태 Probe 대사',
      },
      {
        id: 'exc-003',
        actionRunId: 'act-run-auth-103',
        workspaceId: 'ws-songpa-03',
        workspaceName: '송파 뷰티',
        channel: 'THREADS',
        capabilityId: 'mcp_post_threads_update',
        type: 'AUTH_REVOKED',
        title: '스레드 인증 토큰 만료 (AUTH_REVOKED)',
        detail: 'OAuth 리프레시 토큰 만료로 외부 인가 실패. 세션 재검증이 필요합니다.',
        occurredAt: '2026-09-07T03:20:00Z',
        status: 'PENDING_RECONCILE',
        reconcileActionLabel: '인가 세션 재검증 대사',
      },
      {
        id: 'exc-004',
        actionRunId: 'act-run-budget-104',
        workspaceId: 'ws-mapo-04',
        workspaceName: '마포 스킨',
        channel: 'META_ADS',
        capabilityId: 'mcp_dispatch_meta_ads',
        type: 'BUDGET_EXCEEDED',
        title: '일일 광고 예산 한도 초과 (BUDGET_EXCEEDED)',
        detail: '설정된 일일 상한 50,000 KRW 도달. FinOps 원장 대사 및 안전 정지가 적용되었습니다.',
        occurredAt: '2026-09-07T03:22:00Z',
        status: 'PENDING_RECONCILE',
        reconcileActionLabel: 'FinOps 예산 원장 대사',
      },
    ];

    it('renders all 4 exception status items correctly', () => {
      render(<ExceptionReconcileQueue items={mockExceptions} />);

      expect(screen.getByTestId('exception-reconcile-queue')).toBeDefined();
      expect(screen.getAllByText('RESULT_UNKNOWN').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('PROVIDER_UNPROBED').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('AUTH_REVOKED').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('BUDGET_EXCEEDED').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/인스타그램 피드 발행 후 타임아웃/)).toBeDefined();
      expect(screen.getByText(/네이버 블로그 세션 상태 미확인/)).toBeDefined();
    });

    it('STRICT INVARIANT: prohibits blind retry button and provides ONLY safe reconcile CTA for RESULT_UNKNOWN', () => {
      render(<ExceptionReconcileQueue items={mockExceptions} />);

      const unknownItem = screen.getByTestId('exception-item-exc-001');
      expect(unknownItem).toBeDefined();

      // Blind Retry 버튼 원천 배제 검증
      const retryButtons = unknownItem.querySelectorAll('button');
      retryButtons.forEach((btn) => {
        const text = (btn.textContent || '').toLowerCase();
        expect(text).not.toContain('재시도');
        expect(text).not.toContain('재실행');
        expect(text).not.toContain('retry');
        expect(text).not.toContain('blind');
      });

      // 오직 Reconcile CTA 버튼만 제공됨을 검증
      const reconcileBtn = screen.getByTestId('btn-reconcile-exc-001');
      expect(reconcileBtn).toBeDefined();
      expect(reconcileBtn.textContent).toContain('독립 Readback 안전 대사 (Reconcile)');
    });

    it('triggers onReconcile callback when reconcile CTA is clicked', async () => {
      const onReconcile = vi.fn().mockResolvedValue(undefined);
      render(<ExceptionReconcileQueue items={mockExceptions} onReconcile={onReconcile} />);

      const reconcileBtn = screen.getByTestId('btn-reconcile-exc-001');
      fireEvent.click(reconcileBtn);

      expect(onReconcile).toHaveBeenCalledTimes(1);
      expect(onReconcile).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'exc-001',
          type: 'RESULT_UNKNOWN',
        })
      );
    });

    it('filters exception items by status category tab', () => {
      render(<ExceptionReconcileQueue items={mockExceptions} />);

      const authFilterBtn = screen.getByRole('button', { name: /AUTH_REVOKED/i });
      fireEvent.click(authFilterBtn);

      expect(screen.getByText(/스레드 인증 토큰 만료/)).toBeDefined();
      expect(screen.queryByText(/인스타그램 피드 발행 후 타임아웃/)).toBeNull();
    });
  });

  describe('2. ActionRunInspector (ANI-987 Acceptance Criteria 2: 3-Click Drill-Down Lineage)', () => {
    const mockLineage: ActionRunLineage = {
      actionRun: {
        id: 'act-run-audit-101',
        mission: '인스타그램 룩북 릴스 자동화',
        workspaceId: 'ws-gangnam-01',
        workspaceName: '강남 피부과',
        actionType: 'PUBLISH_CAROUSEL',
        status: 'VERIFIED',
        createdAt: '2026-09-07T03:30:00Z',
      },
      envelope: {
        envelopeId: 'env-aud-8891',
        workspaceId: 'ws-gangnam-01',
        actorId: 'usr_owner_gangnam_01',
        sessionId: 'sess_growth_331',
        goalId: 'goal_insta_lookbook_01',
        actionRunId: 'act-run-audit-101',
        stepIndex: 3,
        capabilityId: 'mcp_post_instagram_carousel',
        inputPayload: {
          itemsCount: 4,
          caption: '강남 피부과 봄맞이 이벤트 실사 룩북',
        },
        idempotencyKey: 'idemp_audit_carousel_99182',
        transportType: 'EXTERNAL_MCP',
        intentMode: 'EXECUTE',
        createdAt: '2026-09-07T03:30:00Z',
      },
      receipt: {
        receiptId: 'rcpt_meta_graph_7721',
        requestId: 'req_graph_disp_551',
        channelId: 'INSTAGRAM',
        status: 'VERIFIED',
        externalContentId: '179928172648102',
        externalUrl: 'https://instagram.com/p/C481928371a',
        screenshotEvidenceUrl: 'https://evidence.sohee.internal/screens/2026/09/07/act-run-audit-101.png',
        verifiedAt: '2026-09-07T03:30:45Z',
        verificationMethod: 'API_READ_AFTER_WRITE',
        evidenceDetails: { httpStatus: 200, permalinkConfirmed: true },
      },
      proofChain: {
        evidenceId: 'ev_chain_act_101',
        workspaceId: 'ws-gangnam-01',
        actionId: 'act-run-audit-101',
        channel: 'INSTAGRAM',
        idempotencyKey: 'idemp_audit_carousel_99182',
        stage: 'EXTERNAL_VERIFIED',
        requestDigest: 'sha256_req_f88a912c9381',
        responseDigest: 'sha256_resp_3910ab3817f',
        readbackDigest: 'sha256_readback_771928aaee1',
        providerObjectId: '179928172648102',
        providerUrl: 'https://instagram.com/p/C481928371a',
        verifierVersion: 'proof-verifier-v2.1',
        timestamps: {
          requestedAt: '2026-09-07T03:30:00Z',
          acceptedAt: '2026-09-07T03:30:15Z',
          verifiedAt: '2026-09-07T03:30:45Z',
        },
        reconcileStatus: 'RECONCILED',
        blocks: [
          {
            index: 0,
            previousHash: '0000000000000000',
            currentHash: 'block_hash_0_genesis',
            timestamp: '2026-09-07T03:30:00Z',
            payloadDigest: 'digest_0_init',
            actionRunId: 'act-run-audit-101',
            stage: 'TRANSPORT_SUCCESS',
          },
          {
            index: 1,
            previousHash: 'block_hash_0_genesis',
            currentHash: 'block_hash_1_accepted',
            timestamp: '2026-09-07T03:30:15Z',
            payloadDigest: 'digest_1_meta_accepted',
            actionRunId: 'act-run-audit-101',
            stage: 'PROVIDER_ACCEPTED',
          },
          {
            index: 2,
            previousHash: 'block_hash_1_accepted',
            currentHash: 'block_hash_2_verified',
            timestamp: '2026-09-07T03:30:45Z',
            payloadDigest: 'digest_2_readback_ok',
            actionRunId: 'act-run-audit-101',
            stage: 'EXTERNAL_VERIFIED',
          },
        ],
      },
      settlement: {
        settlementId: 'stl_finops_9921',
        reservationId: 'res_finops_3310',
        actionRunId: 'act-run-audit-101',
        workspaceId: 'ws-gangnam-01',
        finalSettledCredits: 200,
        releasedCredits: 50,
        balanceBefore: 10000,
        balanceAfter: 9800,
        settledAt: '2026-09-07T03:30:50Z',
        status: 'SETTLED',
        reason: '인스타그램 캐러셀 4단 정상 발행 및 Readback 검증 완료에 따른 최종 정산',
      },
    };

    it('supports 3-click drilldown through ActionRun -> ToolExecutionEnvelope/Receipt -> ProofChainBlock -> FinOpsSettlement', () => {
      render(<ActionRunInspector initialLineage={mockLineage} />);

      expect(screen.getByTestId('action-run-inspector')).toBeDefined();

      // Click 1: ActionRun / ToolExecutionEnvelope 뷰 진입/확인
      const stage1Btn = screen.getByTestId('nav-stage-envelope');
      fireEvent.click(stage1Btn);

      expect(screen.getByText('env-aud-8891')).toBeDefined();
      expect(screen.getByText('idemp_audit_carousel_99182')).toBeDefined();
      expect(screen.getByText('mcp_post_instagram_carousel')).toBeDefined();
      expect(screen.getByText('rcpt_meta_graph_7721')).toBeDefined();

      // Click 2: Readback & ProofChainBlock (증거 체인 블록) 뷰로 드릴다운
      const stage2Btn = screen.getByTestId('nav-stage-evidence');
      fireEvent.click(stage2Btn);

      expect(screen.getByText('ev_chain_act_101')).toBeDefined();
      expect(screen.getByText('sha256_readback_771928aaee1')).toBeDefined();
      expect(screen.getByText('block_hash_2_verified')).toBeDefined();
      expect(screen.getByText('PROVIDER_ACCEPTED')).toBeDefined();
      expect(screen.getByText('EXTERNAL_VERIFIED')).toBeDefined();

      // Click 3: FinOps 정산 대사 (FinOps Settlement) 뷰로 드릴다운
      const stage3Btn = screen.getByTestId('nav-stage-finops');
      fireEvent.click(stage3Btn);

      expect(screen.getByText('stl_finops_9921')).toBeDefined();
      expect(screen.getByText('200 SC')).toBeDefined();
      expect(screen.getByText('50 SC')).toBeDefined();
      expect(screen.getByText('10000 SC ➔ 9800 SC')).toBeDefined();
      expect(screen.getByText(/인스타그램 캐러셀 4단 정상 발행/)).toBeDefined();
    });
  });

  describe('3. AgentsView Control Plane Integration (ANI-987 Acceptance Criteria 3)', () => {
    it('provides integrated tabs for Exception Queue and ActionRun Inspector', () => {
      render(<AgentsView />);

      // 상단 탭에 예외 대사 큐 및 인스펙터가 연동되어 있어야 함
      expect(screen.getByText(/예외 및 대사 큐/i)).toBeDefined();
      expect(screen.getByText(/감사 인스펙터/i)).toBeDefined();

      // 예외 큐 탭 전환 테스트
      const exceptionsTab = screen.getByRole('tab', { name: /예외 및 대사 큐/i });
      fireEvent.click(exceptionsTab);
      expect(screen.getByTestId('exception-reconcile-queue')).toBeDefined();

      // 감사 인스펙터 탭 전환 테스트
      const inspectorTab = screen.getByRole('tab', { name: /감사 인스펙터/i });
      fireEvent.click(inspectorTab);
      expect(screen.getByTestId('action-run-inspector')).toBeDefined();
    });

  });
});
