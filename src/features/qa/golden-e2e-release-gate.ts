/**
 * Sohee V0.9 5th Update · Wave 5 QA & Release Gate
 * 10 Golden Paths & Failure Injection Engine
 * 
 * Traceability: ANI-926
 */

import { createHash } from 'node:crypto';
import {
  BehavioralGoldenRunner,
  type AuthoritativeEvidenceBundle,
  type AuthoritativeEvidenceBundleParams,
} from './behavioral-golden-runner';

export type GoldenPathId =
  | 'EMPTY_TRUTH'
  | 'PLUGIN_READY'
  | 'CHAT_CONTENT_PUBLISH'
  | 'CHAT_ADS'
  | 'CUSTOMER_BOOKING'
  | 'RUNTIME_PAUSE'
  | 'RESULT_UNKNOWN'
  | 'ZERO_CREDIT'
  | 'AUTH_EXPIRY'
  | 'GOAL_CLOSED_LOOP';

export type ReleaseGateStage =
  | 'CODE_COMPLETE'
  | 'TESTED'
  | 'INTEGRATION_VERIFIED'
  | 'DEPLOYED'
  | 'PRODUCTION_SMOKE'
  | 'EXTERNAL_VERIFIED'
  | 'SAME_TRUTH_VERIFIED'
  | 'DONE';

export interface GoldenPathResult {
  pathId: GoldenPathId;
  name: string;
  passed: boolean;
  tenant: 'P-ACTUAL-CANARY' | 'P-EMPTY' | 'P-DEMO';
  evidenceId: string;
  details: string;
  code?: string;
}

export interface FailureInjectionCase {
  code?: string;
  failureType:
    | 'LLM_TIMEOUT'
    | 'PROVIDER_API_500'
    | 'DB_CONNECTION_FAIL'
    | 'QUEUE_BACKPRESSURE'
    | 'BROWSER_CRASH'
    | 'CREDIT_DEPLETED'
    | string;
  expectedBehavior: string;
  actualStatus: 'SAFE_FAIL_CLOSED' | 'UNHANDLED_EXCEPTION' | 'FALSE_GREEN';
  passed: boolean;
  details?: string;
}

export interface GoldenEvidenceBundle {
  bundleId: string;
  commitHash: string;
  workspaceId: string;
  sessionId: string;
  actionRunId: string;
  providerPostId: string;
  evidenceId: string;
  ledgerId: string;
  /**
   * Canonical JSON SHA-256 payload digest (integrity hash).
   * Note: This is an integrity payload digest of canonical metadata, NOT an asymmetric private-key signature
   * and NOT a replacement for operational external provider verification.
   */
  cryptographicSignature: string;
  /** Explicit alias clarifying this value is an integrity payload digest. */
  payloadDigest?: string;
  generatedAt: string;
}

export class GoldenE2EReleaseGate {
  private runner: BehavioralGoldenRunner;

  constructor(runner?: BehavioralGoldenRunner) {
    this.runner = runner || new BehavioralGoldenRunner();
  }

  /**
   * 10대 Golden Path 전수 실행 및 검증 (BehavioralGoldenRunner 위임)
   */
  public execute10GoldenPaths(): GoldenPathResult[] {
    return this.runner.run10GoldenPaths();
  }

  /**
   * 장애 주입(Failure Injection) 내결함성 평가
   */
  public executeFailureInjections(scope: 'CRITICAL_6' | 'ALL_16' = 'CRITICAL_6'): FailureInjectionCase[] {
    const all = this.runner.run16FailureInjections();
    if (scope === 'CRITICAL_6') {
      const criticalTypes = [
        'LLM_TIMEOUT',
        'PROVIDER_API_500',
        'DB_CONNECTION_FAIL',
        'QUEUE_BACKPRESSURE',
        'BROWSER_CRASH',
        'CREDIT_DEPLETED',
      ];
      return all.filter(c => criticalTypes.includes(c.failureType));
    }
    return all;
  }

  /**
   * 16대 Failure Injection (G11~G26) 전수 실행
   */
  public execute16FailureInjections(): FailureInjectionCase[] {
    return this.runner.run16FailureInjections();
  }

  /**
   * Node.js crypto 기반 정본 SHA-256 전자서명 증거 번들 생성
   */
  public createAuthoritativeEvidenceBundle(
    params: AuthoritativeEvidenceBundleParams
  ): AuthoritativeEvidenceBundle {
    return this.runner.createAuthoritativeEvidenceBundle(params);
  }

  /**
   * Production Release Lifecycle 단계 평가
   * Fail-closed Release Gate:
   * CODE_COMPLETE → TESTED → INTEGRATION_VERIFIED → DEPLOYED → PRODUCTION_SMOKE → EXTERNAL_VERIFIED → SAME_TRUTH_VERIFIED → DONE
   */
  public evaluateReleaseGate(params: {
    isCodeComplete: boolean;
    isTested: boolean;
    isIntegrationVerified: boolean;
    isDeployed: boolean;
    isProductionSmokePassed: boolean;
    isExternalVerified: boolean;
    isSameTruthVerified: boolean;
  }): {
    currentStage: ReleaseGateStage;
    canReleaseToDone: boolean;
    blockerReason?: string;
  } {
    if (!params || typeof params !== 'object') {
      return {
        currentStage: 'CODE_COMPLETE',
        canReleaseToDone: false,
        blockerReason: '릴리스 게이트 파라미터가 유효하지 않습니다 (null/undefined)',
      };
    }
    if (params.isCodeComplete !== true) return { currentStage: 'CODE_COMPLETE', canReleaseToDone: false, blockerReason: '코드 구현 미완료' };
    if (params.isTested !== true) return { currentStage: 'TESTED', canReleaseToDone: false, blockerReason: '단위/통합 테스트 미통과' };
    if (params.isIntegrationVerified !== true) return { currentStage: 'INTEGRATION_VERIFIED', canReleaseToDone: false, blockerReason: '전체 컴포넌트 통합 검증 미완료' };
    if (params.isDeployed !== true) return { currentStage: 'DEPLOYED', canReleaseToDone: false, blockerReason: '운영 배포 미실시' };
    if (params.isProductionSmokePassed !== true) return { currentStage: 'PRODUCTION_SMOKE', canReleaseToDone: false, blockerReason: '프로덕션 스모크 검증 미통과' };
    if (params.isExternalVerified !== true) return { currentStage: 'EXTERNAL_VERIFIED', canReleaseToDone: false, blockerReason: '외부 프로바이더 독립 재조회 검증 미완료' };
    if (params.isSameTruthVerified !== true) return { currentStage: 'SAME_TRUTH_VERIFIED', canReleaseToDone: false, blockerReason: 'Service/Admin 동일 진실 불일치' };

    return {
      currentStage: 'DONE',
      canReleaseToDone: true,
    };
  }

  /**
   * Production Evidence Bundle 생성 (정규 SHA-256 페이로드 다이제스트 무결성 검증)
   */
  public createEvidenceBundle(params: {
    commitHash: string;
    workspaceId: string;
    sessionId: string;
    actionRunId: string;
    providerPostId: string;
    ledgerId: string;
  }): GoldenEvidenceBundle {
    const evidenceId = `ev_golden_${params.actionRunId}`;
    const generatedAt = new Date().toISOString();
    const bundleId = `bndl_${createHash('sha256')
      .update(`${params.workspaceId}:${params.actionRunId}:${generatedAt}`)
      .digest('hex')
      .slice(0, 16)}`;

    const canonicalPayload = JSON.stringify({
      bundleId,
      commitHash: params.commitHash,
      workspaceId: params.workspaceId,
      sessionId: params.sessionId,
      actionRunId: params.actionRunId,
      providerPostId: params.providerPostId,
      evidenceId,
      ledgerId: params.ledgerId,
      generatedAt,
    });

    const payloadDigest = createHash('sha256')
      .update(canonicalPayload)
      .digest('hex');

    return {
      bundleId,
      commitHash: params.commitHash,
      workspaceId: params.workspaceId,
      sessionId: params.sessionId,
      actionRunId: params.actionRunId,
      providerPostId: params.providerPostId,
      evidenceId,
      ledgerId: params.ledgerId,
      cryptographicSignature: payloadDigest,
      payloadDigest,
      generatedAt,
    };
  }
}
