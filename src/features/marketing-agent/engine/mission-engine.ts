import { Mission, Opportunity, MissionStep } from "../types";

export function createMissionFromOpportunity(
  opportunity: Opportunity,
  goalId?: string
): Mission {
  let steps: MissionStep[] = [];
  let stopCondition = "예약 확정 시 또는 추가 메시지 거절 시 즉시 중단";
  const fallbackPlan = "미응답 시 7일간 추가 메시지를 보내지 않고 보관함으로 이동";


  if (opportunity.type === "empty_slot") {
    steps = [
      {
        id: "step-1-" + opportunity.id,
        stepNumber: 1,
        title: "문의 고객 분석",
        description: "최근 문의자 중 재접촉 적합 대상 선별 (안전 쿨다운 검증)",
        riskTier: "autonomous_safe",
        status: "completed",
        executedAt: new Date().toISOString(),
        resultSummary: "4명 중 재접촉 가능한 3명 선정 완료 (자동 안전)",
      },
      {
        id: "step-2-" + opportunity.id,
        stepNumber: 2,
        title: "후속 답변 검토",
        description: "사장님 승인 대기 · 개인화 예약 제안 메시지 초안 생성",
        channelKey: "kakaotalk_channel",
        riskTier: "approval_required",
        status: "awaiting_approval",
        approvalRequiredReason: "외부 고객 대상 직접 메시지 발송 정책에 따른 승인 필요",
        payloadDraft: {
          recipientsCount: 3,
          channel: "kakaotalk_channel",
          proposedSlot: "목요일 빈 슬롯",
        },
      },
      {
        id: "step-3-" + opportunity.id,
        stepNumber: 3,
        title: "결과 측정",
        description: "답변율 · 신규 예약 전환 · 방문 일정 추적",
        riskTier: "autonomous_safe",
        status: "pending",
      },
    ];
    stopCondition = "답변이 없으면 추가 메시지를 보내지 않아요.";
  } else if (opportunity.type === "review_gap") {
    steps = [
      {
        id: "step-1-" + opportunity.id,
        stepNumber: 1,
        title: "리뷰 내용 분석 & 키워드 추출",
        description: "긍정 피드백 및 시술 만족도 파악",
        riskTier: "autonomous_safe",
        status: "completed",
        executedAt: new Date().toISOString(),
        resultSummary: "네이버/구글 신규 리뷰 1건 감지 완료",
      },
      {
        id: "step-2-" + opportunity.id,
        stepNumber: 2,
        title: "감사 답글 초안 검토",
        description: "사장님 승인 대기 · 브랜드 톤앤매너 감사 답글 등록",
        channelKey: "google_business",
        riskTier: "approval_required",
        status: "awaiting_approval",
        approvalRequiredReason: "공개 플랫폼 외부 텍스트 게시를 위한 사전 승인",
      },
      {
        id: "step-3-" + opportunity.id,
        stepNumber: 3,
        title: "답글 게시 및 평판 점수 갱신",
        description: "게시 완료 후 매장 신뢰도 지표 반영",
        riskTier: "autonomous_safe",
        status: "pending",
      },
    ];
    stopCondition = "리뷰가 삭제되었거나 고객이 수정한 경우 중단";
  } else {
    steps = [
      {
        id: "step-1-" + opportunity.id,
        stepNumber: 1,
        title: "상황 진단 및 상태 점검",
        description: opportunity.summary,
        riskTier: "autonomous_safe",
        status: "completed",
        executedAt: new Date().toISOString(),
      },
      {
        id: "step-2-" + opportunity.id,
        stepNumber: 2,
        title: opportunity.recommendedActionTitle,
        description: opportunity.recommendedActionDescription,
        riskTier: opportunity.requiresApproval ? "approval_required" : "autonomous_safe",
        status: opportunity.requiresApproval ? "awaiting_approval" : "in_progress",
        approvalRequiredReason: opportunity.requiresApproval ? "외부 영향도가 존재하는 작업 승인" : undefined,
      },
    ];
  }

  return {
    id: "mission-" + opportunity.id,
    workspaceId: opportunity.workspaceId,
    opportunityId: opportunity.id,
    goalId,
    title: opportunity.title.replace("채울 수 있어요.", "채우기"),
    objective: opportunity.summary,
    status: "running",
    steps,
    currentStepIndex: 1, // step-2 awaiting_approval
    stopCondition,
    fallbackPlan,
    startedAt: new Date().toISOString(),
  };
}

export function approveMissionStep(mission: Mission, stepId: string): Mission {
  const updatedSteps = mission.steps.map((step) => {
    if (step.id === stepId) {
      return {
        ...step,
        status: "completed" as const,
        executedAt: new Date().toISOString(),
        resultSummary: "사장님 승인 완료 후 안전하게 실행되었습니다.",
      };
    }
    return step;
  });

  const nextStepIndex = updatedSteps.findIndex((s) => s.status === "pending" || s.status === "awaiting_approval");
  const isAllComplete = updatedSteps.every((s) => s.status === "completed" || s.status === "skipped");

  return {
    ...mission,
    steps: updatedSteps,
    currentStepIndex: nextStepIndex >= 0 ? nextStepIndex : updatedSteps.length - 1,
    status: isAllComplete ? "completed" : "running",
    completedAt: isAllComplete ? new Date().toISOString() : undefined,
  };
}
