'use client';

/**
 * Sohee V0.8.9 / V0.9 Admin Exception & Reconcile Control Plane
 * ActionRun Inspector (ANI-987)
 * 
 * Invariants:
 * 1. 3-click drill-down lineage: ActionRun -> ToolExecutionEnvelope -> ExternalActionReceipt -> ProofChainBlock -> FinOpsSettlement
 * 2. Complete cryptographic digest and block verification inspection.
 * 3. FinOps credit conservation audit visibility.
 */

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Layers,
  ArrowRight,
  ShieldCheck,
  Zap,
  FileCode2,
  CheckCircle2,
  ExternalLink,
  Lock,
  Clock,
  Hash,
  Activity,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import type { ToolExecutionEnvelope } from '@/lib/mcp-gateway/tool-execution-envelope';
import type { ExternalActionReceipt } from '@/lib/channels/external-evidence-verifier';
import type { CanonicalProofChain } from '@/types/evidence-chain';
import type { FinOpsSettlementReceipt } from '@/types/finops-engine';

export interface ActionRunLineage {
  actionRun: {
    id: string;
    mission: string;
    workspaceId: string;
    workspaceName: string;
    actionType: string;
    status: string;
    createdAt: string;
  };
  envelope: ToolExecutionEnvelope;
  receipt: ExternalActionReceipt;
  proofChain: CanonicalProofChain;
  settlement: FinOpsSettlementReceipt;
}

export const DEFAULT_LINEAGE: ActionRunLineage = {
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

type DrilldownStage = 'ENVELOPE' | 'EVIDENCE' | 'FINOPS';

interface ActionRunInspectorProps {
  initialLineage?: ActionRunLineage;
  className?: string;
}

export function ActionRunInspector({
  initialLineage = DEFAULT_LINEAGE,
  className = '',
}: ActionRunInspectorProps) {
  const [currentStage, setCurrentStage] = useState<DrilldownStage>('ENVELOPE');
  const lineage = initialLineage;

  return (
    <Card className={`overflow-hidden border-border/80 shadow-xs ${className}`} data-testid="action-run-inspector">
      <CardHeader className="bg-muted/20 border-b pb-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Layers className="size-5 text-primary" />
              <CardTitle className="text-base md:text-lg font-bold">
                ActionRun 감사 계보 인스펙터 (3-Click Lineage Drilldown)
              </CardTitle>
              <Badge variant="purple" className="text-xs font-mono font-bold">
                {lineage.actionRun.id}
              </Badge>
            </div>
            <CardDescription className="text-xs text-muted-foreground mt-1">
              ActionRun ➔ MCP Envelope ➔ Provider Receipt ➔ Proof Chain ➔ FinOps 정산으로 이어지는 단일 진실 계보를 감사합니다.
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="success" className="text-xs font-semibold">
              {lineage.actionRun.status}
            </Badge>
            <Badge variant="outline" className="text-xs font-mono">
              {lineage.actionRun.workspaceName}
            </Badge>
          </div>
        </div>

        {/* 3-Click Stepper Bar */}
        <div className="grid grid-cols-3 gap-2 pt-4">
          <Button
            variant={currentStage === 'ENVELOPE' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setCurrentStage('ENVELOPE')}
            data-testid="nav-stage-envelope"
            className="h-10 text-xs justify-start gap-2 shadow-xs transition-all font-semibold"
          >
            <div className="size-5 rounded-full bg-background/20 text-current flex items-center justify-center font-bold text-[10px]">
              1
            </div>
            <div className="text-left truncate">
              <div className="leading-tight">실행 엔벨로프</div>
              <div className="text-[10px] opacity-80 font-normal">Envelope & Receipt</div>
            </div>
          </Button>

          <Button
            variant={currentStage === 'EVIDENCE' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setCurrentStage('EVIDENCE')}
            data-testid="nav-stage-evidence"
            className="h-10 text-xs justify-start gap-2 shadow-xs transition-all font-semibold"
          >
            <div className="size-5 rounded-full bg-background/20 text-current flex items-center justify-center font-bold text-[10px]">
              2
            </div>
            <div className="text-left truncate">
              <div className="leading-tight">증거 체인 블록</div>
              <div className="text-[10px] opacity-80 font-normal">Readback & Blocks</div>
            </div>
          </Button>

          <Button
            variant={currentStage === 'FINOPS' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setCurrentStage('FINOPS')}
            data-testid="nav-stage-finops"
            className="h-10 text-xs justify-start gap-2 shadow-xs transition-all font-semibold"
          >
            <div className="size-5 rounded-full bg-background/20 text-current flex items-center justify-center font-bold text-[10px]">
              3
            </div>
            <div className="text-left truncate">
              <div className="leading-tight">FinOps 정산 원장</div>
              <div className="text-[10px] opacity-80 font-normal">Settlement Receipt</div>
            </div>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-5">
        {/* Stage 1: ActionRun & ToolExecutionEnvelope & Receipt */}
        {currentStage === 'ENVELOPE' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Tool Execution Envelope Card */}
              <div className="p-4 rounded-xl border bg-muted/20 space-y-3">
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-xs font-bold flex items-center gap-1.5 text-foreground">
                    <FileCode2 className="size-4 text-primary" />
                    ToolExecutionEnvelope (표준 엔벨로프)
                  </span>
                  <Badge variant="purple" className="font-mono text-[10px]">
                    {lineage.envelope.transportType}
                  </Badge>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-[10px] text-muted-foreground">엔벨로프 ID</dt>
                    <dd className="font-mono font-semibold text-foreground break-all">
                      {lineage.envelope.envelopeId}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-muted-foreground">역량 식별자 (Capability)</dt>
                    <dd className="font-mono font-semibold text-primary break-all">
                      {lineage.envelope.capabilityId}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-muted-foreground">멱등성 키 (IdempotencyKey)</dt>
                    <dd className="font-mono font-semibold text-foreground break-all">
                      {lineage.envelope.idempotencyKey}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-muted-foreground">실행 모드 (IntentMode)</dt>
                    <dd className="font-mono font-semibold text-state-ok">
                      {lineage.envelope.intentMode}
                    </dd>
                  </div>
                </dl>
                <div>
                  <span className="text-[10px] text-muted-foreground">Input Payload</span>
                  <pre className="p-2.5 rounded-lg bg-background border text-[11px] font-mono overflow-x-auto text-muted-foreground mt-1">
                    {JSON.stringify(lineage.envelope.inputPayload, null, 2)}
                  </pre>
                </div>
              </div>

              {/* Provider Receipt Card */}
              <div className="p-4 rounded-xl border bg-muted/20 space-y-3">
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-xs font-bold flex items-center gap-1.5 text-foreground">
                    <CheckCircle2 className="size-4 text-state-ok" />
                    ExternalActionReceipt (공급자 접수 영수증)
                  </span>
                  <Badge variant="success" className="font-mono text-[10px]">
                    {lineage.receipt.status}
                  </Badge>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-[10px] text-muted-foreground">영수증 ID (ReceiptId)</dt>
                    <dd className="font-mono font-semibold text-foreground break-all">
                      {lineage.receipt.receiptId}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-muted-foreground">채널 (Channel)</dt>
                    <dd className="font-mono font-semibold text-foreground">
                      {lineage.receipt.channelId}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-muted-foreground">외부 객체 ID</dt>
                    <dd className="font-mono font-semibold text-foreground break-all">
                      {lineage.receipt.externalContentId || 'N/A'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-muted-foreground">검증 방식 (Method)</dt>
                    <dd className="font-mono font-semibold text-primary text-[11px]">
                      {lineage.receipt.verificationMethod}
                    </dd>
                  </div>
                </dl>
                {lineage.receipt.externalUrl && (
                  <div className="pt-2 border-t text-xs">
                    <span className="text-[10px] text-muted-foreground">외부 실증빙 URL</span>
                    <p className="font-mono text-xs text-primary truncate hover:underline flex items-center gap-1 mt-0.5">
                      <ExternalLink className="size-3 shrink-0" />
                      {lineage.receipt.externalUrl}
                    </p>
                  </div>
                )}
                {lineage.receipt.screenshotEvidenceUrl && (
                  <div className="text-xs">
                    <span className="text-[10px] text-muted-foreground">브라우저 스크린샷 증빙</span>
                    <p className="font-mono text-[11px] text-muted-foreground truncate mt-0.5">
                      {lineage.receipt.screenshotEvidenceUrl}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                size="sm"
                onClick={() => setCurrentStage('EVIDENCE')}
                className="gap-1.5 text-xs font-semibold"
              >
                다음 계보: 증거 체인 검증 (Proof Chain) <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Stage 2: ProofChainBlock & Readback Verification */}
        {currentStage === 'EVIDENCE' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="p-4 rounded-xl border bg-muted/20 space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="text-xs font-bold flex items-center gap-1.5 text-foreground">
                  <ShieldCheck className="size-4 text-state-ok" />
                  CanonicalProofChain (불변 증거 체인 & Readback 요약)
                </span>
                <Badge variant="outline" className="font-mono text-[10px] text-state-ok border-state-ok/30">
                  {lineage.proofChain.verifierVersion}
                </Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="p-2.5 rounded-lg bg-background border">
                  <span className="text-[10px] text-muted-foreground">증거 체인 ID (EvidenceId)</span>
                  <p className="font-mono font-bold text-foreground text-xs mt-0.5">
                    {lineage.proofChain.evidenceId}
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-background border">
                  <span className="text-[10px] text-muted-foreground">대사 상태 (ReconcileStatus)</span>
                  <p className="font-mono font-bold text-state-ok text-xs mt-0.5">
                    {lineage.proofChain.reconcileStatus}
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-background border">
                  <span className="text-[10px] text-muted-foreground">독립 Readback 다이제스트</span>
                  <p className="font-mono font-bold text-primary text-[11px] truncate mt-0.5">
                    {lineage.proofChain.readbackDigest}
                  </p>
                </div>
              </div>

              {/* Cryptographic Proof Blocks */}
              <div className="space-y-2 pt-2">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Hash className="size-3.5 text-muted-foreground" />
                  암호학적 증거 체인 블록 ({lineage.proofChain.blocks.length}개 블록)
                </span>
                <div className="space-y-2">
                  {lineage.proofChain.blocks.map((block) => (
                    <div
                      key={block.index}
                      className="p-3 rounded-lg bg-background border hover:border-primary/40 transition-colors text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px] font-mono">
                            Block #{block.index}
                          </Badge>
                          <Badge variant="purple" className="text-[10px] font-semibold">
                            {block.stage}
                          </Badge>
                        </div>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {block.timestamp}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] font-mono text-muted-foreground pt-1">
                        <div>
                          <span className="text-[10px] text-muted-foreground/80">Previous Hash:</span>
                          <p className="truncate">{block.previousHash}</p>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground/80">Current Hash:</span>
                          <p className="font-bold text-foreground truncate">{block.currentHash}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentStage('ENVELOPE')}
                className="text-xs"
              >
                이전: 실행 엔벨로프
              </Button>
              <Button
                size="sm"
                onClick={() => setCurrentStage('FINOPS')}
                className="gap-1.5 text-xs font-semibold"
              >
                다음 계보: FinOps 정산 대사 <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Stage 3: FinOps Settlement Receipt */}
        {currentStage === 'FINOPS' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="p-4 rounded-xl border bg-muted/20 space-y-4">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="text-xs font-bold flex items-center gap-1.5 text-foreground">
                  <Zap className="size-4 text-state-warn" />
                  FinOpsSettlementReceipt (원장 정산 영수증)
                </span>
                <Badge variant="success" className="font-mono text-[10px]">
                  {lineage.settlement.status}
                </Badge>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-background border space-y-1">
                  <span className="text-[10px] text-muted-foreground">최종 정산 차감 (Settled)</span>
                  <p className="text-xl font-extrabold font-mono text-state-warn">
                    {lineage.settlement.finalSettledCredits} SC
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-background border space-y-1">
                  <span className="text-[10px] text-muted-foreground">유휴 환불 (Released)</span>
                  <p className="text-xl font-extrabold font-mono text-state-ok">
                    {lineage.settlement.releasedCredits} SC
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-background border space-y-1 col-span-2">
                  <span className="text-[10px] text-muted-foreground">잔액 변동 (Balance Delta)</span>
                  <p className="text-sm font-bold font-mono text-foreground mt-1">
                    {lineage.settlement.balanceBefore} SC ➔ {lineage.settlement.balanceAfter} SC
                  </p>
                </div>
              </div>

              <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-1">
                <div>
                  <dt className="text-[10px] text-muted-foreground">정산 영수증 ID</dt>
                  <dd className="font-mono font-semibold text-foreground">
                    {lineage.settlement.settlementId}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] text-muted-foreground">예약 ID (ReservationId)</dt>
                  <dd className="font-mono font-semibold text-foreground">
                    {lineage.settlement.reservationId}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[10px] text-muted-foreground">정산 사유 및 감사 증빙</dt>
                  <dd className="font-medium text-foreground bg-background p-2.5 rounded-lg border mt-1">
                    {lineage.settlement.reason}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentStage('EVIDENCE')}
                className="text-xs"
              >
                이전: 증거 체인 블록
              </Button>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs font-mono text-state-ok bg-state-ok/5">
                  <CheckCircle2 className="size-3 mr-1 inline" /> 3단계 전체 계보 대사 일치
                </Badge>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
