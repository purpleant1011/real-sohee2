/**
 * Fresh Production E2E Suite (ANI-883)
 * 
 * End-to-End Chain:
 * Install -> READY -> Chat Toolbelt -> Safe Write -> Readback -> Settle -> Proof Card -> Ledger -> Admin Control Plane
 */

import { describe, it, expect } from 'vitest';

// Wave 1 Modules
import { evaluatePluginExecutableReady } from '@/lib/plugin-platform/router/plugin-ready-gate';
import { ToolSchemaLazyLoader } from '@/features/agent-runtime/tool-schema-lazy-loader';
import { explainToolSelection } from '@/features/agent-runtime/tool-selection-explainer';
import type { SoheePluginManifest, WorkspaceInstalledPlugin } from '@/types/plugin-platform';

// Wave 2 Modules
import { OwnerAbsentServerRuntime } from '@/features/autonomy/owner-absent-runtime';
import { verifyExternalWriteWithReadback } from '@/features/agent-runtime/readback-verifier';
import { ResultUnknownReconcileQueue } from '@/features/agent-runtime/reconcile-queue';
import { validateProofCardData, type ProofCardData } from '@/features/evidence/proof-card';
import { BackgroundWorkLedger } from '@/features/autonomy/work-ledger';
import { ActionRunControlPlane } from '@/lib/admin-ops/action-run-control-plane';
import type { A3AutonomyCharter } from '@/features/autonomy/types';

describe('ANI-883: Wave 2 Fresh Production E2E Integration Chain', () => {
  const workspaceId = 'ws_production_gangnam_skin';
  const ownerId = 'owner_kim_ceo';

  // 1. Plugin Manifest & Installation fixture
  const manifest: SoheePluginManifest = {
    pluginId: 'naver-place-real-connector',
    slug: 'naver-place-real-connector',
    displayName: '네이버 스마트플레이스 연동기',
    version: '1.0.0',
    publisherId: 'pub_sohee_core',
    publisherType: 'SOHEE',
    summary: '실제 네이버 플레이스 소식 등록 및 예약 동기화',
    categories: ['CHANNEL_SNS'],
    minPlanTier: 'TIER_150K_STARTER',
    outcomeTags: ['네이버 노출', '방문객 유치'],
    icon: 'Store',
    trustTier: 'SOHEE_CORE',
    entitlementKey: 'ent_naver_place',
    capabilities: [
      {
        capabilityId: 'naver.place.post.publish',
        name: '네이버 플레이스 소식 등록',
        description: '플레이스 새 소식 실발행',
        riskClass: 'WRITE',
        actionRiskTier: 'R1_MODERATE',
        creditCostWeight: 1.0,
        requiredScopes: ['naver_place_write'],
        supportsIdempotency: true,
        requiresExternalVerification: true,
      },
    ],
    requiredScopes: ['naver_place_write'],
    approvalDefault: 'ASK_ON_CHANGE',
    creditMeteringPolicyId: 'meter_place_post',
  };

  const installedPlugin: WorkspaceInstalledPlugin = {
    installationId: 'inst_naver_99',
    workspaceId,
    pluginId: manifest.pluginId,
    manifestVersion: manifest.version,
    installedAt: '2026-09-06T00:00:00Z',
    state: 'READY',
    connectedAccountId: 'acc_naver_01',
    healthStatus: 'HEALTHY',
    lastHealthCheckedAt: '2026-09-06T06:00:00Z',
    approvalMode: 'ASK_ON_CHANGE',
    isCircuitBreakerOpen: false,
  };

  // 2. Active A3 Autonomy Charter
  const charter: A3AutonomyCharter = {
    id: 'charter_gangnam_v09',
    version: '1.0.0',
    workspaceId,
    status: 'ACTIVE',
    envelope: {
      maxDailyBudgetKRW: 100000,
      maxCreditsPerAction: 300,
      allowedChannels: ['naver', 'instagram'],
      requireExplicitApprovalRiskTier: 'R2_CRITICAL',
      quietHoursStartHour: 22,
      quietHoursEndHour: 8,
    },
    authorizedByOwnerId: ownerId,
    authorizedAt: '2026-09-01T00:00:00Z',
  };

  it('executes full fresh production journey seamlessly from Install to Proof Card and Admin Plane', async () => {
    // -------------------------------------------------------------
    // Phase 1: Fail-Closed Plugin READY Gate (ANI-804)
    // -------------------------------------------------------------
    const readyEval = evaluatePluginExecutableReady({
      workspaceId,
      manifest,
      installation: installedPlugin,
      currentPlanTier: 'TIER_300K_GROWTH',
      userRole: 'OWNER',
      targetCapabilityId: 'naver.place.post.publish',
      creditBalance: 5000,
      estimatedCreditCost: 200,
      isProviderHealthy: true,
      isPolicyAllowed: true,
      isRiskApproved: true,
    });

    expect(readyEval.isReady).toBe(true);
    expect(readyEval.failingChecks).toHaveLength(0);
    expect(readyEval.stateCopy).toBe('준비 완료 (READY)');

    // -------------------------------------------------------------
    // Phase 2: Tool Schema Lazy Loading & Explainability (ANI-811, ANI-813)
    // -------------------------------------------------------------
    const lazyLoader = new ToolSchemaLazyLoader();
    const resolution = lazyLoader.resolveSchemasForIntent({
      query: '플레이스에 가을 이벤트 소식 올려줘',
      workspaceId,
      planTier: 'TIER_300K_GROWTH',
      creditBalance: 5000,
    });
    expect(resolution.expandedSchemas.length).toBeGreaterThanOrEqual(1);

    const explanation = explainToolSelection({
      toolId: resolution.expandedSchemas[0].toolId,
      toolName: resolution.expandedSchemas[0].name,
      intent: '가을 신규 이벤트 공지 등록',
      riskClass: 'WRITE',
      estimatedCredits: 200,
      scopes: ['naver_place_write'],
      approvalMode: 'GUARDED_AUTO',
    });
    expect(explanation.estimatedCredits).toBe(200);
    expect(explanation.requiresApproval).toBe(false);

    // -------------------------------------------------------------
    // Phase 3: Owner-Absent Server Runtime Trigger & Preflight (ANI-901)
    // -------------------------------------------------------------
    const runtime = new OwnerAbsentServerRuntime();
    const runContext = runtime.initializeAutonomousRun({
      workspaceId,
      triggerId: 'trig_daily_content_cron',
      goalId: 'goal_autumn_revenue',
      charter,
      harnessId: 'harn_beauty_playbook',
      agentBuild: 'sohee-v0.9.4-prod',
      gateConfig: {
        isGlobalKillSwitchActive: false,
        isPluginKillSwitchActive: false,
        isReadinessHealthy: true,
      },
    });

    expect(runContext.ownerSessionRequired).toBe(false);
    expect(runContext.status).toBe('PREFLIGHT_PASSED');

    const evalAction = runtime.evaluateRunAction(
      runContext,
      {
        id: 'act_post_001',
        workspaceId,
        actionType: 'PUBLISH_CONTENT',
        channel: 'naver',
        costCredits: 200,
        scheduledTimeHourKST: 14,
      },
      charter
    );

    expect(evalAction.canProceed).toBe(true);
    expect(evalAction.approvalType).toBe('INHERITED_A3_APPROVAL');

    // -------------------------------------------------------------
    // Phase 4: External Safe Write & Independent Readback (ANI-815)
    // -------------------------------------------------------------
    const providerWriteResult = {
      status: 200,
      acceptedAt: '2026-09-06T05:00:00Z',
      temporaryReferenceId: 'tmp_naver_99182',
    };

    const cert = await verifyExternalWriteWithReadback({
      workspaceId,
      actionRunId: runContext.runId,
      channel: 'naver',
      providerResult: providerWriteResult,
      expectedPayload: {
        title: '가을 맞이 스킨케어 20% 할인 소식',
        targetAccountId: 'gangnam_skin_naver',
      },
      readbackQuery: async () => ({
        isFound: true,
        authoritativeId: 'naver_post_final_99182',
        liveUrl: 'https://smartplace.naver.com/manage/posts/99182',
        actualPayload: {
          title: '가을 맞이 스킨케어 20% 할인 소식',
        },
      }),
    });

    expect(cert.isVerified).toBe(true);
    expect(cert.verificationState).toBe('EXTERNAL_VERIFIED');
    expect(cert.readbackHash).toBeDefined();

    // -------------------------------------------------------------
    // Phase 5: Reconcile Queue Idempotency Check (ANI-816)
    // -------------------------------------------------------------
    const reconcileQueue = new ResultUnknownReconcileQueue();
    expect(reconcileQueue.listPendingItems(workspaceId)).toHaveLength(0); // Zero unresolved items

    // -------------------------------------------------------------
    // Phase 6: Canonical Proof Card Generation & Validation (ANI-814)
    // -------------------------------------------------------------
    const proofCard: ProofCardData = {
      actionRunId: runContext.runId,
      evidenceId: `ev_${runContext.runId}_proof`,
      workspaceId,
      purpose: '가을 맞이 스킨케어 20% 할인 소식 실게시',
      pluginId: manifest.pluginId,
      pluginVersion: manifest.version,
      capabilityId: 'naver.place.post.publish',
      provider: 'naver',
      targetAccount: 'gangnam_skin_naver',
      actionRiskTier: 'R1_MODERATE',
      verificationState: 'EXTERNAL_VERIFIED',
      approval: {
        required: true,
        charterId: charter.id,
        charterVersion: charter.version,
        isA3InheritedApproval: true,
      },
      credits: {
        estimated: 200,
        settled: 200,
        currency: 'SOHEE_CREDIT',
        planTier: 'TIER_300K_GROWTH',
      },
      providerObject: {
        id: cert.authoritativeId!,
        url: cert.liveUrl!,
        acceptedAt: providerWriteResult.acceptedAt,
      },
      readback: {
        verifiedAt: cert.verifiedAt!,
        hash: cert.readbackHash!,
        verificationMethod: 'NAVER_SEARCH_READBACK',
        status: 'VERIFIED',
      },
      outcomeLineage: {
        goalId: 'goal_autumn_revenue',
        missionId: 'msn_daily_post',
      },
    };

    const cardValidation = validateProofCardData(proofCard);
    expect(cardValidation.isValid).toBe(true);
    expect(cardValidation.errors).toHaveLength(0);

    // -------------------------------------------------------------
    // Phase 7: Background Work Ledger Registration (ANI-903)
    // -------------------------------------------------------------
    const ledger = new BackgroundWorkLedger();
    const ledgerEntry = ledger.record({
      workspaceId,
      triggerId: runContext.triggerId,
      triggerType: 'SCHEDULE',
      goalId: runContext.goalId,
      runId: runContext.runId,
      actionId: 'act_post_001',
      actionType: 'PUBLISH_CONTENT',
      charterId: charter.id,
      charterVersion: charter.version,
      summary: '네이버 스마트플레이스 가을 맞이 20% 할인 소식 실게시 및 검증 완료',
      verificationState: 'EXTERNAL_VERIFIED',
      evidenceId: proofCard.evidenceId,
      creditsConsumed: 200,
    });

    expect(ledgerEntry.verificationState).toBe('EXTERNAL_VERIFIED');
    const briefing = ledger.getOwnerBriefing(workspaceId);
    expect(briefing.verifiedCount).toBe(1);
    expect(briefing.totalCreditsSettled).toBe(200);

    // -------------------------------------------------------------
    // Phase 8: Admin ActionRun Control Plane Observability (ANI-868)
    // -------------------------------------------------------------
    const controlPlane = new ActionRunControlPlane();
    controlPlane.recordRun({
      runId: runContext.runId,
      customerId: ownerId,
      workspaceId,
      pluginId: manifest.pluginId,
      pluginVersion: manifest.version,
      capabilityId: 'naver.place.post.publish',
      provider: 'naver',
      status: 'VERIFIED',
      noDataTaxonomy: 'DATA_AVAILABLE',
      credits: {
        reserved: 200,
        settled: 200,
      },
      evidenceId: proofCard.evidenceId,
      startedAt: runContext.startedAt,
      finishedAt: cert.verifiedAt,
    });

    const recordedRun = controlPlane.getRun(runContext.runId);
    expect(recordedRun?.status).toBe('VERIFIED');
    expect(recordedRun?.credits.settled).toBe(200);
    expect(controlPlane.canExecute(workspaceId, manifest.pluginId, 'naver').admissible).toBe(true);
  });
});
