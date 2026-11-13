import {
  MeasurementHealthSummary,
  SourceHealthCheck,
  DataSourceStatus,
} from './types';

export class MeasurementHealthService {
  /**
   * 5대 측정 데이터 소스 신선도 및 커버리지 건강도 평가 (ANI-855)
   */
  evaluateHealth(params: {
    workspaceId: string;
    sourceMetrics: Array<{
      sourceName: SourceHealthCheck['sourceName'];
      lastEventReceivedAt: string;
      coverageRatePercent: number;
      untrackedEventsCount: number;
    }>;
  }): MeasurementHealthSummary {
    const { workspaceId, sourceMetrics } = params;
    const nowMs = Date.now();

    const evaluatedSources: SourceHealthCheck[] = sourceMetrics.map((sm) => {
      const eventMs = new Date(sm.lastEventReceivedAt).getTime();
      const stalenessHours = Math.max(0, Math.floor((nowMs - eventMs) / (1000 * 60 * 60)));

      let status: DataSourceStatus = 'HEALTHY';
      let remedyAction: string | undefined;

      if (stalenessHours > 48 || sm.coverageRatePercent < 50) {
        status = 'DISCONNECTED';
        remedyAction = `${sm.sourceName} 연동이 끊어졌거나 심각한 누락이 발생했습니다. 채널 재인증이 필요합니다.`;
      } else if (stalenessHours > 24 || sm.coverageRatePercent < 80) {
        status = 'STALE';
        remedyAction = `${sm.sourceName} 데이터 수집이 24시간 이상 정체되었습니다. 동기화 작업을 트리거하세요.`;
      } else if (sm.coverageRatePercent < 90) {
        status = 'DEGRADED';
        remedyAction = `일부 UTM 파라미터가 유실되었습니다. 링크 태그 형식을 점검하세요.`;
      }

      return {
        sourceName: sm.sourceName,
        status,
        lastEventReceivedAt: sm.lastEventReceivedAt,
        stalenessHours,
        coverageRatePercent: sm.coverageRatePercent,
        untrackedEventsCount: sm.untrackedEventsCount,
        remedyAction,
      };
    });

    // 전체 건강도 점수 산출
    const avgCoverage =
      evaluatedSources.length > 0
        ? evaluatedSources.reduce((sum, s) => sum + s.coverageRatePercent, 0) / evaluatedSources.length
        : 0;

    let healthScore = Math.round(avgCoverage);
    const hasDisconnected = evaluatedSources.some((s) => s.status === 'DISCONNECTED');
    const hasStale = evaluatedSources.some((s) => s.status === 'STALE');

    let overallStatus: DataSourceStatus = 'HEALTHY';
    if (hasDisconnected) {
      overallStatus = 'DISCONNECTED';
      healthScore = Math.min(healthScore, 40);
    } else if (hasStale) {
      overallStatus = 'STALE';
      healthScore = Math.min(healthScore, 65);
    } else if (healthScore < 85) {
      overallStatus = 'DEGRADED';
    }

    return {
      workspaceId,
      overallStatus,
      healthScore,
      sources: evaluatedSources,
      evaluatedAt: new Date().toISOString(),
    };
  }
}
