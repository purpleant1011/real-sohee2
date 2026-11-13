import { ContentGenerationService, ContentBrief } from "./content-generation-service";
import { SupportedPublishChannel } from "./publishing-service";
import { SafeActionService } from "./safe-action-service";

export interface AutonomousLoopExecutionResult {
  loopId: string;
  workspaceId: string;
  status: "completed" | "no_op" | "blocked" | "needs_approval";
  summary: string;
  opportunityCreated?: string;
  missionCreated?: string;
  contentCreated?: string;
  publishedChannels?: SupportedPublishChannel[];
  reason?: string;
  executedAt: string;
}

export class AgentOrchestrator {
  /**
   * Runs the daily autonomous marketing loop for a workspace
   */
  static async runDailyLoop(workspaceId: string): Promise<AutonomousLoopExecutionResult> {
    // 1. Observe & Diagnose
    // In production, check remaining slots, recent reviews, trend keywords
    const hasEmptySlot = true;

    if (!hasEmptySlot) {
      return {
        loopId: `loop_${Date.now()}`,
        workspaceId,
        status: "no_op",
        summary: "현재 즉시 행동할 긴급 기회가 없어 다음 정기 점검(15:00)까지 대기합니다.",
        executedAt: new Date().toISOString(),
      };
    }

    // 2. Prioritize & Create Opportunity
    const oppId = `opp_${Date.now()}`;
    const missionId = `ms_${Date.now()}`;

    // 3. Plan & Generate Content Brief
    const brief: ContentBrief = {
      opportunityId: oppId,
      missionId,
      objective: "이번 주 목요일 19:00 잔여 슬롯 1자리 예약 전환",
      targetAudience: "청라 지역 뷰티/케어 관심 고객",
      topic: "자연스러운 결을 살리는 바이름 시그니처 케어",
      channelTargets: ["instagram", "threads", "naver_blog"],
      brandMemorySnapshots: [
        "1:1 맞춤 디자인 원칙",
        "프리미엄 인증 재료 사용",
        "목요일 19:00 잔여 1자리",
      ],
      cta: "네이버 예약 또는 인스타그램 DM으로 잔여 슬롯 확인",
    };

    // 4. Generate Differentiated Channel Variants
    const content = await ContentGenerationService.generateFromBrief(workspaceId, brief);

    // 5. Register in SafeAction Layer (Awaiting Owner Confirmation)
    SafeActionService.registerExecution(
      workspaceId,
      "daily_campaign_publish",
      "multi_channel",
      content.id,
      "approval_pending"
    );

    return {
      loopId: `loop_${Date.now()}`,
      workspaceId,
      status: "needs_approval",
      summary: "목요일 잔여 슬롯 대응 3개 채널(인스타, 스레드, 블로그) 콘텐츠를 준비했습니다. 확인 후 1건 승인 대기 중입니다.",
      opportunityCreated: oppId,
      missionCreated: missionId,
      contentCreated: content.id,
      executedAt: new Date().toISOString(),
    };
  }
}
