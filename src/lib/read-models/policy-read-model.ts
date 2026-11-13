export interface PolicyAuditLog {
  id: string;
  timestamp: string;
  actor: string;
  event: string;
  detail: string;
  previousValue?: string;
  newValue?: string;
}

export interface AutomationPolicyReadModel {
  workspaceId: string;
  workspaceKillSwitch: {
    isActive: boolean;
    activatedAt?: string;
    activatedBy?: string;
    reason?: string;
  };
  globalKillSwitch: boolean;
  approvalMode: 'always_require' | 'require_for_external' | 'autonomous_safe_only';
  dailySpendCap: number;
  dailySendCap: number;
  currentDaySpend: number;
  currentDaySends: number;
  quietHours: {
    enabled: boolean;
    startTime: string;
    endTime: string;
  };
  cooldownMinutes: number;
  auditLogs: PolicyAuditLog[];
}

export interface GetPolicyParams {
  workspaceId: string;
}

export function getAutomationPolicyReadModel(params: GetPolicyParams): AutomationPolicyReadModel {
  return {
    workspaceId: params.workspaceId,
    workspaceKillSwitch: {
      isActive: false,
    },
    globalKillSwitch: false,
    approvalMode: 'require_for_external',
    dailySpendCap: 50000,
    dailySendCap: 100,
    currentDaySpend: 45,
    currentDaySends: 3,
    quietHours: {
      enabled: true,
      startTime: '21:00',
      endTime: '09:00',
    },
    cooldownMinutes: 1440, // 24시간
    auditLogs: [
      {
        id: 'audit-001',
        timestamp: '2026-08-30 09:00:12',
        actor: 'system',
        event: '일일 발송 및 지출 카운터 리셋',
        detail: '매일 09:00 자동 초기화 완료',
      },
      {
        id: 'audit-002',
        timestamp: '2026-08-29 18:30:00',
        actor: '사장님 (admin@example.com)',
        event: '자동화 승인 정책 변경',
        detail: '외부 고객 발송 시 사장님 승인 필수 적용',
        previousValue: 'always_require',
        newValue: 'require_for_external',
      },
    ],
  };
}
