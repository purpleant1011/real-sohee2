import { describe, it, expect, beforeEach } from 'vitest';
import { ToolDispatcher } from '@/features/tool-runtime/tool-dispatcher';
import { DynamicCapabilityDiscovery } from '@/lib/mcp-gateway/dynamic-capability-discovery';
import { CapabilityStatusRegistry } from '@/lib/mcp-gateway/capability-status-registry';

describe('ANI-920 / Task B: campaign.plan exclusion from implemented capabilities', () => {
  const WORKSPACE_ID = 'ws-test-campaign-plan';

  beforeEach(() => {
    CapabilityStatusRegistry.resetForTest(WORKSPACE_ID);
  });

  it('fails closed with NOT_IMPLEMENTED when campaign.plan is dispatched', async () => {
    const result = await ToolDispatcher.dispatch(
      'campaign.plan',
      { goal: '봄맞이 신규 고객 유치' },
      {
        workspaceId: WORKSPACE_ID,
        correlationId: 'test-corr-plan-exclude',
      }
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe('NOT_IMPLEMENTED');
    expect(result.error?.code).toBe('NOT_IMPLEMENTED');
  });

  it('excludes campaign.plan from operational capabilities in discovery and records exclusion reason', async () => {
    const discovery = await DynamicCapabilityDiscovery.getRelevantOperationalCapabilities({
      goal: '프로모션 캠페인 기획해줘',
      surfaceContext: 'CAMPAIGN',
      workspaceId: WORKSPACE_ID,
    });

    const toolIds = discovery.openAiTools.map((t: any) => t.function.name);
    expect(toolIds).not.toContain('campaign.plan');

    const exclusion = discovery.exclusionReasons.find((e) => e.capabilityId === 'campaign.plan');
    expect(exclusion).toBeDefined();
    expect(exclusion?.status).toBe('NOT_IMPLEMENTED');
  });
});
