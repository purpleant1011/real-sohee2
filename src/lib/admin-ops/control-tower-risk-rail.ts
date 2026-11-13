/**
 * Admin Control Tower Risk Rail & Actionable Alerts (ANI-881, ANI-882)
 */

export type RiskRailLevel =
  | 'LEVEL_1_INFO'
  | 'LEVEL_2_ATTENTION_REQUIRED'
  | 'LEVEL_3_OPERATOR_ACTION_NEEDED'
  | 'LEVEL_4_CRITICAL_BLOCKED';

export interface ActionableAlert {
  alertId: string;
  source: string; // 예: "Meta Graph API Provider"
  impact: string; // 예: "3개 매장의 인스타그램 예약 포스팅 지연"
  freshnessMinutes: number; // 데이터 발생 후 경과 시간
  rootCause: string; // 예: "Access token expired during renewal"
  remediationAction: string; // 예: "OAuth 재인증 링크 발송 및 토큰 리프레시 실행"
  riskLevel: RiskRailLevel;
  workspaceId?: string;
  isResolved: boolean;
  createdAt: string;
}

export class ControlTowerRiskRailService {
  private alerts: Map<string, ActionableAlert> = new Map();

  createActionableAlert(params: {
    source: string;
    impact: string;
    freshnessMinutes: number;
    rootCause: string;
    remediationAction: string;
    riskLevel: RiskRailLevel;
    workspaceId?: string;
  }): ActionableAlert {
    const alertId = `alt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const alert: ActionableAlert = {
      alertId,
      ...params,
      isResolved: false,
      createdAt: new Date().toISOString(),
    };

    this.alerts.set(alertId, alert);
    return alert;
  }

  resolveAlert(alertId: string): ActionableAlert {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    alert.isResolved = true;
    return alert;
  }

  listUnresolvedByRiskLevel(level?: RiskRailLevel): ActionableAlert[] {
    return Array.from(this.alerts.values()).filter((a) => {
      if (a.isResolved) return false;
      if (level && a.riskLevel !== level) return false;
      return true;
    });
  }
}
