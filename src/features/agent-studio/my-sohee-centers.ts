/**
 * 마이 소희 3대 센터 통합 서비스
 * 
 * ANI-889: Capability & Connection Center
 * ANI-890: Work Command Center
 * ANI-891: Automation & Learning Center
 */

export interface CapabilityScore {
  planning: number; // 0 ~ 100
  copywriting: number;
  visualDirection: number;
  counseling: number;
  analytics: number;
}

export interface WorkCommandBriefing {
  briefingId: string;
  workspaceId: string;
  date: string;
  summary: string;
  operatingRules: string[];
  activeCampaignCount: number;
  priorityTasks: string[];
}

export interface AutomationRoutine {
  routineId: string;
  workspaceId: string;
  name: string;
  cronExpression: string;
  actionType: string;
  isEnabled: boolean;
  weeklyOutcomeAttributionKrw: number;
}

export class MySoheeCentersService {
  private briefings: Map<string, WorkCommandBriefing> = new Map();
  private routines: Map<string, AutomationRoutine> = new Map();

  /**
   * ANI-889: 역량 및 채널 연결 상태 종합 산출
   */
  evaluateCapabilities(params: {
    readyPluginsCount: number;
    connectedChannelsCount: number;
    taughtKnowledgeCount: number;
  }): {
    overallLevel: number; // 1 ~ 5
    scores: CapabilityScore;
    levelName: string;
  } {
    const { readyPluginsCount, connectedChannelsCount, taughtKnowledgeCount } = params;

    const baseScore = Math.min(60, connectedChannelsCount * 20);
    const knowledgeBonus = Math.min(25, taughtKnowledgeCount * 5);
    const pluginBonus = Math.min(15, readyPluginsCount * 5);

    const total = baseScore + knowledgeBonus + pluginBonus;

    const scores: CapabilityScore = {
      planning: Math.min(100, 70 + knowledgeBonus),
      copywriting: Math.min(100, 65 + knowledgeBonus),
      visualDirection: Math.min(100, 60 + pluginBonus),
      counseling: Math.min(100, 75 + knowledgeBonus),
      analytics: Math.min(100, 70 + baseScore / 2),
    };

    let overallLevel = 1;
    let levelName = '인턴 소희';
    if (total >= 90) {
      overallLevel = 5;
      levelName = '수석 마케팅 디렉터 소희';
    } else if (total >= 75) {
      overallLevel = 4;
      levelName = '책임 마케터 소희';
    } else if (total >= 60) {
      overallLevel = 3;
      levelName = '선임 매니저 소희';
    } else if (total >= 40) {
      overallLevel = 2;
      levelName = '주니어 마케터 소희';
    }

    return { overallLevel, scores, levelName };
  }

  /**
   * ANI-890: 일일 브리핑 및 운영 수칙 생성
   */
  createDailyBriefing(params: {
    workspaceId: string;
    summary: string;
    operatingRules: string[];
    priorityTasks: string[];
  }): WorkCommandBriefing {
    const { workspaceId, summary, operatingRules, priorityTasks } = params;
    const briefingId = `brf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const briefing: WorkCommandBriefing = {
      briefingId,
      workspaceId,
      date: new Date().toISOString().slice(0, 10),
      summary,
      operatingRules,
      activeCampaignCount: 3,
      priorityTasks,
    };

    this.briefings.set(workspaceId, briefing);
    return briefing;
  }

  getLatestBriefing(workspaceId: string): WorkCommandBriefing | undefined {
    return this.briefings.get(workspaceId);
  }

  /**
   * ANI-891: 자율 자동화 루틴 등록 및 성과 기여도 관리
   */
  registerRoutine(params: {
    workspaceId: string;
    name: string;
    cronExpression: string;
    actionType: string;
  }): AutomationRoutine {
    const { workspaceId, name, cronExpression, actionType } = params;
    const routineId = `rtn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const routine: AutomationRoutine = {
      routineId,
      workspaceId,
      name,
      cronExpression,
      actionType,
      isEnabled: true,
      weeklyOutcomeAttributionKrw: 0,
    };

    this.routines.set(routineId, routine);
    return routine;
  }

  recordRoutineOutcome(routineId: string, revenueKrw: number): void {
    const routine = this.routines.get(routineId);
    if (routine) {
      routine.weeklyOutcomeAttributionKrw += revenueKrw;
    }
  }

  listRoutines(workspaceId: string): AutomationRoutine[] {
    return Array.from(this.routines.values()).filter((r) => r.workspaceId === workspaceId);
  }
}
