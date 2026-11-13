import { describe, it, expect } from 'vitest';
import { ActionRunControlPlane, type ActionRunControlRecord } from '../action-run-control-plane';

describe('ANI-868: Admin ActionRun Control Plane', () => {
  const sampleRun: ActionRunControlRecord = {
    runId: 'act_run_100',
    customerId: 'cust_01',
    workspaceId: 'ws_gangnam',
    pluginId: 'naver-place-sync',
    pluginVersion: '1.2.0',
    capabilityId: 'naver.place.post',
    provider: 'naver',
    status: 'VERIFIED',
    noDataTaxonomy: 'DATA_AVAILABLE',
    credits: {
      reserved: 200,
      settled: 200,
    },
    evidenceId: 'ev_100',
    outcomeId: 'out_100',
    startedAt: '2026-09-06T10:00:00Z',
    finishedAt: '2026-09-06T10:00:03Z',
  };

  it('records, queries, and filters ActionRun objects by status and workspace', () => {
    const cp = new ActionRunControlPlane();
    cp.recordRun(sampleRun);

    const fetched = cp.getRun('act_run_100');
    expect(fetched).toEqual(sampleRun);

    const verifiedRuns = cp.listRuns({ status: 'VERIFIED' });
    expect(verifiedRuns).toHaveLength(1);

    const emptyRuns = cp.listRuns({ workspaceId: 'ws_other' });
    expect(emptyRuns).toHaveLength(0);
  });

  it('evaluates and enforces 4 independent tiers of interruption controls', () => {
    const cp = new ActionRunControlPlane();

    // 1. Initial State: All admissible
    expect(cp.canExecute('ws_gangnam', 'naver-place-sync', 'naver').admissible).toBe(true);

    // 2. Tier 4: Workspace Autonomy Pause
    cp.setWorkspaceAutonomyPause('ws_gangnam', true);
    const resPause = cp.canExecute('ws_gangnam', 'naver-place-sync', 'naver');
    expect(resPause.admissible).toBe(false);
    expect(resPause.blockedByTier).toBe('WORKSPACE_AUTONOMY_PAUSE');

    // Unpause workspace
    cp.setWorkspaceAutonomyPause('ws_gangnam', false);

    // 3. Tier 3: Provider Circuit Breaker
    cp.setProviderCircuitBreaker('naver', true);
    const resBreaker = cp.canExecute('ws_gangnam', 'naver-place-sync', 'naver');
    expect(resBreaker.admissible).toBe(false);
    expect(resBreaker.blockedByTier).toBe('PROVIDER_CIRCUIT_BREAKER');

    // Close circuit breaker
    cp.setProviderCircuitBreaker('naver', false);

    // 4. Tier 2: Plugin Kill Switch
    cp.setPluginKillSwitch('naver-place-sync', true);
    const resPlugin = cp.canExecute('ws_gangnam', 'naver-place-sync', 'naver');
    expect(resPlugin.admissible).toBe(false);
    expect(resPlugin.blockedByTier).toBe('PLUGIN_KILL_SWITCH');

    // Unkill plugin
    cp.setPluginKillSwitch('naver-place-sync', false);

    // 5. Tier 1: Global Kill Switch
    cp.setGlobalKillSwitch(true);
    const resGlobal = cp.canExecute('ws_gangnam', 'naver-place-sync', 'naver');
    expect(resGlobal.admissible).toBe(false);
    expect(resGlobal.blockedByTier).toBe('GLOBAL_KILL_SWITCH');
  });
});
