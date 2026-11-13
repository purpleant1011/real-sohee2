export interface MarginEvaluation {
  workspaceId: string;
  revenueKrw: number;
  totalCost: number;
  grossMarginPercentage: number;
  healthStatus: 'HEALTHY' | 'WARNING' | 'NEGATIVE_MARGIN_RISK';
  throttleRecommended: boolean;
}

export class ProfitabilityMarginEngine {
  evaluateWorkspaceMargin(params: {
    workspaceId: string;
    revenueKrw: number;
    costs: {
      llmTokensKrw: number;
      cloudflareWorkersKrw: number;
      mcpExecutionKrw: number;
    };
  }): MarginEvaluation {
    const totalCost =
      params.costs.llmTokensKrw +
      params.costs.cloudflareWorkersKrw +
      params.costs.mcpExecutionKrw;

    const grossMarginPercentage = Math.round(
      ((params.revenueKrw - totalCost) / params.revenueKrw) * 100
    );

    let healthStatus: MarginEvaluation['healthStatus'] = 'HEALTHY';
    let throttleRecommended = false;

    if (grossMarginPercentage < 30) {
      healthStatus = 'NEGATIVE_MARGIN_RISK';
      throttleRecommended = true;
    } else if (grossMarginPercentage < 65) {
      healthStatus = 'WARNING';
      throttleRecommended = false;
    }

    return {
      workspaceId: params.workspaceId,
      revenueKrw: params.revenueKrw,
      totalCost,
      grossMarginPercentage,
      healthStatus,
      throttleRecommended,
    };
  }
}
