
import { BusinessGoal, Opportunity } from "../types";

export interface CouncilReviewPerspective {
  role: "local_demand_expert" | "content_strategist" | "revenue_analyst" | "brand_risk_reviewer" | "devils_advocate";
  perspectiveName: string;
  verdict: "strongly_support" | "conditional_support" | "oppose";
  reasoning: string;
  cautionPoint?: string;
}

export interface CouncilDecisionReport {
  goalId: string;
  opportunityId: string;
  synthesizedRecommendation: string;
  confidenceScore: number;
  perspectives: CouncilReviewPerspective[];
  timestamp: string;
}

export function evaluateWithStrategyCouncil(
  goal: BusinessGoal,
  opportunity: Opportunity
): CouncilDecisionReport {
  return {
    goalId: goal.id,
    opportunityId: opportunity.id,
    synthesizedRecommendation: "목요일 빈 슬롯 대상 맞춤 후속 메시지 발송을 추천하되, 사장님 승인 필터를 거치고 수신동의 고객 3명에 한정하여 발송함.",
    confidenceScore: 92,
    perspectives: [
      {
        role: "revenue_analyst",
        perspectiveName: "매출/전환 분석가",
        verdict: "strongly_support",
        reasoning: "주간 목표(10건) 달성까지 2건이 부족한 상황에서, 추가 광고비 지출 0원으로 1~2건을 즉시 확보할 수 있는 최고 효율 행동임.",
      },
      {
        role: "brand_risk_reviewer",
        perspectiveName: "브랜드 위험 검토자",
        verdict: "conditional_support",
        reasoning: "과도한 광고성 스팸 느낌이 나지 않도록 차분한 존댓말 톤앤매너 템플릿을 준수하고 반드시 사전 승인을 거쳐야 함.",
        cautionPoint: "자극적인 할인 문구 사용 금지",
      },
      {
        role: "devils_advocate",
        perspectiveName: "지정된 반대자 (Devil Advocate)",
        verdict: "conditional_support",
        reasoning: "미예약 문의 고객에게 재접촉 시 거절 피로도가 발생할 수 있으므로, 1회 발송 후 미응답 시 즉시 쿨다운(7일)으로 중단해야 함.",
        cautionPoint: "미응답 시 2차 독촉 발송 절대 금지",
      },
    ],
    timestamp: new Date().toISOString(),
  };
}
