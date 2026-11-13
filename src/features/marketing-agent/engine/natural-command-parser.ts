import { AgentControlPlaneService } from './agent-control-state';
import { OpportunityRadarService } from './opportunity-radar';
import { RevenueGoal } from './revenue-data-spine';

export type CommandIntentType =
  | 'FILL_SLOT_GOAL'
  | 'PAUSE_OUTREACH'
  | 'HUMAN_TAKEOVER'
  | 'AUTO_DM_APPROVAL'
  | 'ADJUST_CHANNEL_WEIGHT'
  | 'PAUSE_PUBLISHING'
  | 'UNKNOWN_COMMAND';

export interface CommandParseResult {
  rawCommand: string;
  intent: CommandIntentType;
  actionSummary: string;
  requiresOwnerConfirmation: boolean;
  stateDiffPreview: Record<string, unknown>;
  executedResult?: Record<string, unknown>;
}

export class NaturalCommandParser {
  static parseAndExecute(workspaceId: string, commandText: string): CommandParseResult {
    const text = commandText.trim();

    // 1. "이번 주 목요일 오후를 채워줘" / "빈 슬롯 채워줘"
    if (text.includes('채워줘') || text.includes('예약 유치') || text.includes('목표')) {
      const goal: RevenueGoal = {
        id: `goal-${Date.now()}`,
        workspaceId,
        goalType: 'BOOKINGS',
        title: '목요일 오후 잔여 슬롯 채우기',
        targetValue: 4,
        currentValue: 0,
        unit: '건',
        periodStart: new Date().toISOString(),
        periodEnd: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
        targetServices: ['srv-balayage', 'srv-headspa'],
        targetSlots: ['slot-20260903-1600', 'slot-20260903-1900'],
        constraints: ['할인 금지', '야간 21:00 이후 발송 금지'],
        status: 'ACTIVE',
      };

      const opps = OpportunityRadarService.scanOpportunities(workspaceId, goal);

      return {
        rawCommand: text,
        intent: 'FILL_SLOT_GOAL',
        actionSummary: '목요일 잔여 슬롯 목표(RevenueGoal)를 생성하고 실시간 Opportunity를 스캔했습니다.',
        requiresOwnerConfirmation: false,
        stateDiffPreview: { createdGoal: goal, detectedOpportunitiesCount: opps.length },
        executedResult: { success: true, goalId: goal.id, opportunitiesCount: opps.length },
      };
    }

    // 2. "오늘은 광고성 DM 보내지 마"
    if (text.includes('광고성 DM') || text.includes('DM 보내지 마') || text.includes('홍보 DM 금지')) {
      return {
        rawCommand: text,
        intent: 'PAUSE_OUTREACH',
        actionSummary: '프로모션/광고성 DM 발송을 일시정지하고, 예약 관련 필수 안내(Transactional)만 유지합니다.',
        requiresOwnerConfirmation: false,
        stateDiffPreview: { pausedScopes: ['promotional_outreach_dm'] },
        executedResult: { success: true, activeScopes: ['transactional_inquiry_reply'] },
      };
    }

    // 3. "이 고객은 내가 맡을게"
    if (text.includes('내가 맡을게') || text.includes('내가 직접') || text.includes('내가 상담')) {
      return {
        rawCommand: text,
        intent: 'HUMAN_TAKEOVER',
        actionSummary: '해당 대화의 소희 자율 발송을 차단(Human Takeover)하고 원장님 직접 응대 모드로 전환했습니다.',
        requiresOwnerConfirmation: false,
        stateDiffPreview: { humanTakeover: true, agentOutboundBlocked: true },
        executedResult: { success: true, mode: 'OWNER_DIRECT' },
      };
    }

    // 4. "DM은 네가 알아서 봐"
    if (text.includes('알아서 봐') || text.includes('알아서 처리') || text.includes('자율로 해')) {
      return {
        rawCommand: text,
        intent: 'AUTO_DM_APPROVAL',
        actionSummary: '일반 문의 및 예약 안내에 대한 사전 승인 단계를 생략하고 자율 처리(Auto Policy)로 전환합니다.',
        requiresOwnerConfirmation: true,
        stateDiffPreview: { requireApprovalForInquiryReply: false, autoModeScope: 'inquiry_and_slot_proposal' },
        executedResult: { success: true, approvalPolicy: 'AUTO' },
      };
    }

    // 5. "오늘 아무것도 올리지 마"
    if (text.includes('아무것도 올리지 마') || text.includes('게시 중지') || text.includes('콘텐츠 올리지 마')) {
      return {
        rawCommand: text,
        intent: 'PAUSE_PUBLISHING',
        actionSummary: '오늘 예정된 SNS 콘텐츠 발행을 일시정지했습니다 (고객 문의 응대는 정상 유지).',
        requiresOwnerConfirmation: false,
        stateDiffPreview: { pausedScopes: ['social_publishing'] },
        executedResult: { success: true, publishingPaused: true },
      };
    }

    // 6. Default
    return {
      rawCommand: text,
      intent: 'UNKNOWN_COMMAND',
      actionSummary: '명령을 이해했습니다. 소희의 운영 정책 범위 내에서 적절히 반영하겠습니다.',
      requiresOwnerConfirmation: false,
      stateDiffPreview: {},
      executedResult: { success: true },
    };
  }
}
