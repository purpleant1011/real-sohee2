/**
 * Sohee V0.9 5th Update · Wave 3 Workbenches
 * Workbench Registry & Canonical Context Binding
 * 
 * Traceability: ANI-935, ANI-934
 */

import {
  WorkbenchId,
  WorkbenchMetadata,
  SEVEN_SERVICE_WORKBENCHES,
  CanonicalWorkbenchLineage,
  WorkbenchAgentLifecycleState,
  DatasetMode,
  FORBIDDEN_UI_LABELS,
  sanitizeProductionDisplayLabel,
  resolveDockPresentationMode,
  DockPresentationMode,
} from '@/types/workbench-contract';

export class WorkbenchRegistry {
  /**
   * 7개 등록 워크벤치 목록 반환
   */
  public static getAllWorkbenches(): WorkbenchMetadata[] {
    return Object.values(SEVEN_SERVICE_WORKBENCHES);
  }

  /**
   * 워크벤치 ID로 메타데이터 조회
   */
  public static getWorkbench(id: WorkbenchId): WorkbenchMetadata {
    const wb = SEVEN_SERVICE_WORKBENCHES[id];
    if (!wb) {
      throw new Error(`[WorkbenchRegistry] Unknown workbench ID: ${id}`);
    }
    return wb;
  }

  /**
   * 현재 웹 라우트 경로로부터 워크벤치 ID 판별
   */
  public static resolveWorkbenchFromPathname(pathname: string): WorkbenchMetadata {
    const normalized = pathname.toLowerCase();
    
    if (normalized.startsWith('/app/content')) {
      return SEVEN_SERVICE_WORKBENCHES.content;
    }
    if (normalized.startsWith('/app/customers')) {
      return SEVEN_SERVICE_WORKBENCHES.customers;
    }
    if (normalized.startsWith('/app/results')) {
      return SEVEN_SERVICE_WORKBENCHES.results;
    }
    if (normalized.startsWith('/app/sohee')) {
      return SEVEN_SERVICE_WORKBENCHES.sohee;
    }
    if (normalized.startsWith('/app/ads')) {
      return SEVEN_SERVICE_WORKBENCHES.ads;
    }
    if (normalized.startsWith('/app/system')) {
      return SEVEN_SERVICE_WORKBENCHES.system;
    }
    
    // Default to Home
    return SEVEN_SERVICE_WORKBENCHES.home;
  }

  /**
   * 워크벤치와 연동된 Canonical Lineage 생성
   */
  public static createCanonicalLineage(params: {
    workspaceId: string;
    workbenchId: WorkbenchId;
    agentSessionId: string;
    threadId: string;
    conversationId: string;
    goalId?: string;
    planId?: string;
    actionRunId?: string;
    datasetMode?: DatasetMode;
    currentState?: WorkbenchAgentLifecycleState;
  }): CanonicalWorkbenchLineage {
    return {
      workspaceId: params.workspaceId,
      workbenchId: params.workbenchId,
      agentSessionId: params.agentSessionId,
      threadId: params.threadId,
      conversationId: params.conversationId,
      goalId: params.goalId,
      planId: params.planId,
      actionRunId: params.actionRunId,
      currentState: params.currentState || 'MESSAGE',
      datasetMode: params.datasetMode || 'ACTUAL',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * UI 라벨 및 텍스트의 안정성 검증
   * Figma 내부 노드나 mock/dummy 라벨이 감지되면 위반 사유 반환
   */
  public static validateUiSafety(text: string): { isValid: boolean; violations: string[] } {
    const violations: string[] = [];
    for (const pattern of FORBIDDEN_UI_LABELS) {
      if (pattern.test(text)) {
        violations.push(`Forbidden pattern matched: ${pattern.toString()}`);
      }
    }
    return {
      isValid: violations.length === 0,
      violations,
    };
  }

  /**
   * 뷰포트 너비에 따른 도크 표시 모드 결정
   */
  public static getDockMode(widthPx: number): DockPresentationMode {
    return resolveDockPresentationMode(widthPx);
  }
}
