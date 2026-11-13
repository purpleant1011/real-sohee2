import type { AgentBuild } from '@/types/autonomous-outcome-os';

const ALLOWED_MCP_TOOLS = new Set([
  'mcp_generate_content',
  'mcp_rewrite_tone',
  'mcp_list_content',
  'mcp_schedule_content',
  'mcp_generate_visual_image',
  'mcp_variant_image',
  'mcp_create_campaign',
  'mcp_plan_campaign_detail',
  'mcp_get_campaign_status',
  'mcp_get_connected_channels',
  'mcp_check_channel_health',
  'mcp_get_channel_capabilities',
  'mcp_test_publish_channel',
  'mcp_publish_live',
  'mcp_verify_post',
  'mcp_get_weekly_report',
  'mcp_get_roi_analytics',
  'mcp_get_goal_status',
  'mcp_get_customer_segments',
  'mcp_query_customers',
  'mcp_analyze_leads',
  'mcp_draft_comment_reply',
  'mcp_reply_comment',
  'mcp_draft_dm_response',
  'mcp_review_interactions',
  'mcp_query_business_facts',
  'mcp_propose_knowledge',
  'mcp_check_knowledge_conflicts',
  'mcp_get_system_health',
  'mcp_get_credit_balance',
  'mcp_check_killswitch_status',
  'mcp_control_autonomy',
  'mcp_emergency_killswitch',
]);

const REGISTERED_BUILDS: Record<string, AgentBuild> = {
  'v0.9.0-gemini-flash-prod': {
    agentBuildId: 'build_v090_gemini_prod_01',
    buildTag: 'v0.9.0-gemini-flash-prod',
    primaryPlannerModel: 'gemini-3.8-flash',
    thinkingBudget: 'medium',
    systemPromptVersion: 'sys_prompt_v09_outcome_os_v1',
    toolSchemaVersion: 'mcp_registry_v09_33tools',
    policyContractVersion: 'policy_bundle_v09_a3_envelopes',
    evalBenchmarkScore: 98.4,
    isCanaryActive: true,
    releasedAt: '2026-09-04T00:00:00Z',
  },
};

export function getAgentBuild(buildTag = 'v0.9.0-gemini-flash-prod'): AgentBuild {
  const build = REGISTERED_BUILDS[buildTag];
  if (!build) {
    throw new Error(`등록되지 않은 Agent Build입니다: ${buildTag}`);
  }
  return build;
}

export function validateStructuredPlanSchema(plan: {
  goalId: string;
  missions: Array<{
    id: string;
    actions: Array<{ tool: string; risk_tier?: string }>;
  }>;
}): { valid: boolean; error?: string } {
  if (!plan.goalId || !Array.isArray(plan.missions) || plan.missions.length === 0) {
    return { valid: false, error: '유효한 goalId 및 미션 목록이 필요합니다.' };
  }

  for (const mission of plan.missions) {
    for (const action of mission.actions || []) {
      if (!ALLOWED_MCP_TOOLS.has(action.tool)) {
        return {
          valid: false,
          error: `허용되지 않은 MCP 도구 호출(Hallucination 차단): ${action.tool}`,
        };
      }
    }
  }

  return { valid: true };
}
