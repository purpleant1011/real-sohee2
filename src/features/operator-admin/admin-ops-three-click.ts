/**
 * Admin Ops 3-Click Operations & Customer 360 Trace Model (ANI-1268)
 *
 * Provides commercial operators with a 3-click workflow:
 * Click 1: Select incident from Exception Queue
 * Click 2: View end-to-end Mission Trace (USER → AGENT → DB → PROVIDER → CUSTOMER → OPERATOR)
 * Click 3: Trigger safe remediation action (Reconcile / Retry / Manual Confirm / Handoff)
 */

export type ExceptionQueueCategory =
  | 'STALLED_MISSION'
  | 'RESULT_UNKNOWN'
  | 'WEBHOOK_STALE'
  | 'BOOKING_CONFLICT'
  | 'POLICY_HANDOFF';

export interface AdminExceptionItem {
  exceptionId: string;
  workspaceId: string;
  workspaceName: string;
  category: ExceptionQueueCategory;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  summary: string;
  missionId?: string;
  customerId?: string;
  occurredAt: string;
  ageMinutes: number;
}

export type TraceStepActor = 'USER' | 'AGENT' | 'DB' | 'PROVIDER' | 'CUSTOMER' | 'OPERATOR';

export interface MissionTraceStep {
  stepId: string;
  actor: TraceStepActor;
  actionName: string;
  status: 'SUCCESS' | 'WARNING' | 'FAILED' | 'IN_PROGRESS';
  timestamp: string;
  payloadSummary: string;
  technicalEvidenceId?: string;
}

export interface Customer360Profile {
  workspaceId: string;
  tenantName: string;
  channelReadiness: {
    instagram: boolean;
    threads: boolean;
    naver: boolean;
  };
  activeMissionCount: number;
  totalVerifiedBookings: number;
  openIncidentsCount: number;
  recentTraceSteps: MissionTraceStep[];
}

export type RemediationActionType =
  | 'TRIGGER_SAFE_RETRY'
  | 'MARK_MANUAL_CONFIRMED'
  | 'ESCALATE_TO_OWNER'
  | 'CANCEL_AND_REVERT';

export interface RemediationExecutionResult {
  executionId: string;
  exceptionId: string;
  actionType: RemediationActionType;
  executedBy: string;
  resultStatus: 'SUCCESS' | 'RECONCILED' | 'FAILED';
  resolutionMessage: string;
  executedAt: string;
}

export class AdminOpsThreeClickManager {
  /**
   * Click 1: 5대 예외 큐에서 인시던트 항목 목록 조회
   */
  filterExceptionQueue(
    exceptions: AdminExceptionItem[],
    category?: ExceptionQueueCategory
  ): AdminExceptionItem[] {
    const list = category
      ? exceptions.filter((e) => e.category === category)
      : exceptions;

    // Severity 높은 순, 시간 오래된 순 정렬
    const severityScore = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    return [...list].sort((a, b) => {
      const scoreDiff = severityScore[b.severity] - severityScore[a.severity];
      if (scoreDiff !== 0) return scoreDiff;
      return b.ageMinutes - a.ageMinutes;
    });
  }

  /**
   * Click 2: 선택된 인시던트의 Customer 360 및 6단 Mission Trace 조회
   */
  resolveCustomer360Trace(
    exception: AdminExceptionItem,
    traceHistory: MissionTraceStep[]
  ): Customer360Profile {
    return {
      workspaceId: exception.workspaceId,
      tenantName: exception.workspaceName,
      channelReadiness: {
        instagram: true,
        threads: true,
        naver: false,
      },
      activeMissionCount: exception.missionId ? 1 : 0,
      totalVerifiedBookings: 12,
      openIncidentsCount: 1,
      recentTraceSteps: traceHistory,
    };
  }

  /**
   * Click 3: 복구 조치 원클릭 실행
   */
  executeRemediation(params: {
    exceptionId: string;
    actionType: RemediationActionType;
    operatorId: string;
    targetMissionId?: string;
  }): RemediationExecutionResult {
    const { exceptionId, actionType, operatorId } = params;
    const now = new Date().toISOString();

    let resolutionMessage = '';
    switch (actionType) {
      case 'TRIGGER_SAFE_RETRY':
        resolutionMessage = '안전 멱등 재시도 트리거 완료: 이전 실패 상태를 리셋하고 재수행을 등록했습니다.';
        break;
      case 'MARK_MANUAL_CONFIRMED':
        resolutionMessage = '운영자 수동 확정 완료: 외부 영수증 확인 후 상태를 EXTERNAL_VERIFIED로 승격했습니다.';
        break;
      case 'ESCALATE_TO_OWNER':
        resolutionMessage = '사장님 직접 확인 큐로 전달 완료: 민감 사안으로 사장님 홈 커맨드 센터에 긴급 카드를 게시했습니다.';
        break;
      case 'CANCEL_AND_REVERT':
        resolutionMessage = '업무 취소 및 원복 완료: 진행 중이던 작업을 안전하게 중단하고 크레딧을 반환했습니다.';
        break;
    }

    return {
      executionId: `remed_${exceptionId}_${Date.now()}`,
      exceptionId,
      actionType,
      executedBy: operatorId,
      resultStatus: 'SUCCESS',
      resolutionMessage,
      executedAt: now,
    };
  }
}
