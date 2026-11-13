export type SafeActionStatus =
  | "draft"
  | "approval_pending"
  | "approved"
  | "queued"
  | "executing"
  | "verification_pending"
  | "succeeded"
  | "failed"
  | "canceled"
  | "blocked_by_policy"
  | "needs_reauth"
  | "needs_user_action";

export interface ActionExecutionRecord {
  id: string;
  workspaceId: string;
  actionType: string;
  channel: string;
  target?: string;
  idempotencyKey: string;
  status: SafeActionStatus;
  attemptCount: number;
  providerRequestId?: string;
  externalPostId?: string;
  externalUrl?: string;
  verifiedAt?: string;
  errorMessage?: string;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SafeActionContext {
  workspaceId: string;
  actionType: string;
  channel: string;
  contentRevision: string;
  budgetCapKrw?: number;
  currentDailySpendKrw?: number;
  killSwitchActive: boolean;
  quietHoursActive?: boolean;
}

// In-memory persistent execution store for demo/development & backend tracking
const executionRegistry = new Map<string, ActionExecutionRecord>();

export class SafeActionService {
  /**
   * Generates a deterministic idempotency key for an action
   */
  static generateIdempotencyKey(
    workspaceId: string,
    actionType: string,
    channel: string,
    contentRevision: string,
    timeWindow: string = new Date().toISOString().slice(0, 10)
  ): string {
    return `${workspaceId}:${actionType}:${channel}:${contentRevision}:${timeWindow}`;
  }

  /**
   * Validates pre-flight conditions before executing any action
   */
  static validatePreflight(context: SafeActionContext): {
    allowed: boolean;
    reason?: string;
    statusIfBlocked?: SafeActionStatus;
  } {
    // 1. Workspace Kill Switch Check
    if (context.killSwitchActive) {
      return {
        allowed: false,
        reason: "워크스페이스 긴급 Kill Switch가 활성화되어 모든 외부 행동이 즉시 차단되었습니다.",
        statusIfBlocked: "blocked_by_policy",
      };
    }

    // 2. Quiet Hours (야간 방해금지 시간) Check
    if (context.quietHoursActive) {
      return {
        allowed: false,
        reason: "야간 방해금지 시간(21:00~09:00) 중이므로 발송이 대기열에 보관됩니다.",
        statusIfBlocked: "queued",
      };
    }

    // 3. Daily Budget Cap Check
    if (
      context.budgetCapKrw !== undefined &&
      context.currentDailySpendKrw !== undefined &&
      context.currentDailySpendKrw >= context.budgetCapKrw
    ) {
      return {
        allowed: false,
        reason: `일일 지출 한도(${context.budgetCapKrw.toLocaleString()}원)를 초과하여 자동 발송이 차단되었습니다.`,
        statusIfBlocked: "blocked_by_policy",
      };
    }

    return { allowed: true };
  }

  /**
   * Registers a new durable action execution or returns existing idempotent record
   */
  static registerExecution(
    workspaceId: string,
    actionType: string,
    channel: string,
    contentRevision: string,
    initialStatus: SafeActionStatus = "draft"
  ): ActionExecutionRecord {
    const idempotencyKey = this.generateIdempotencyKey(
      workspaceId,
      actionType,
      channel,
      contentRevision
    );

    const existing = executionRegistry.get(idempotencyKey);
    if (existing) {
      return existing;
    }

    const record: ActionExecutionRecord = {
      id: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      workspaceId,
      actionType,
      channel,
      idempotencyKey,
      status: initialStatus,
      attemptCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    executionRegistry.set(idempotencyKey, record);
    return record;
  }

  /**
   * Updates status and verifies execution
   */
  static transitionStatus(
    idempotencyKey: string,
    nextStatus: SafeActionStatus,
    extra?: {
      providerRequestId?: string;
      externalPostId?: string;
      externalUrl?: string;
      errorMessage?: string;
      errorCode?: string;
    }
  ): ActionExecutionRecord {
    const record = executionRegistry.get(idempotencyKey);
    if (!record) {
      throw new Error(`Execution record not found for key: ${idempotencyKey}`);
    }

    record.status = nextStatus;
    record.updatedAt = new Date().toISOString();

    if (extra?.providerRequestId) record.providerRequestId = extra.providerRequestId;
    if (extra?.externalPostId) record.externalPostId = extra.externalPostId;
    if (extra?.externalUrl) record.externalUrl = extra.externalUrl;
    if (extra?.errorMessage) record.errorMessage = extra.errorMessage;
    if (extra?.errorCode) record.errorCode = extra.errorCode;
    if (nextStatus === "succeeded") {
      record.verifiedAt = new Date().toISOString();
    }

    executionRegistry.set(idempotencyKey, record);
    return record;
  }

  /**
   * Retrieves all executions for a workspace
   */
  static getExecutions(workspaceId: string): ActionExecutionRecord[] {
    return Array.from(executionRegistry.values()).filter(
      (e) => e.workspaceId === workspaceId
    );
  }
}
