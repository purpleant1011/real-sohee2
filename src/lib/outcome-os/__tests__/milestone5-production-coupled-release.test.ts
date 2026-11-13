import { describe, it, expect, vi } from 'vitest';
import {
  AutonomousOutcomeRehearsalEngine,
} from '../release/autonomous-outcome-rehearsal';
import {
  DriftProviderWatchdog,
} from '../release/drift-provider-watchdog';
import {
  DeploymentReversalEngine,
} from '../release/deployment-reversal-engine';
import {
  CoupledReleaseGatekeeper,
} from '../release/coupled-release-gatekeeper';
import {
  AdminEmergencyDrillSimulator,
} from '../release/admin-emergency-drill';

describe('Milestone 5: Production Evidence Gate, Primary E2E Rehearsal & Coupled Release (ANI-681~685, ANI-698)', () => {
  const mockWorkspaceId = 'ws_rehearsal_prod_01';

  describe('ANI-681: Primary E2E Rehearsal - Owner Logout & Full Autonomous Loop', () => {
    it('executes full autonomous loop without owner intervention and delivers verified receipt', async () => {
      const rehearsal = new AutonomousOutcomeRehearsalEngine();

      const result = await rehearsal.executeRehearsal({
        workspaceId: mockWorkspaceId,
        ownerSessionActive: false, // Owner logged out!
        goalId: 'goal_autumn_campaign',
        envelopeId: 'env_bounded_a3_01',
        mockMcpOutcome: {
          externalPostId: 'meta_post_991823',
          permalink: 'https://instagram.com/p/meta_post_991823',
          publishedText: '강남 바이름 가을 시그니처 케어 특별 이벤트',
        },
      });

      expect(result.success).toBe(true);
      expect(result.ownerInterventionRequired).toBe(false);
      expect(result.executionRunId).toBeDefined();
      expect(result.receipt.verificationStatus).toBe('VERIFIED');
      expect(result.receipt.proofReceiptId).toContain('rcpt_');
      expect(result.energySpent).toBeGreaterThan(0);
      expect(result.activityTimelineItem.status).toBe('VERIFIED');
    });
  });

  describe('ANI-682: Drift & Provider Health Watchdog', () => {
    it('detects healthy schema status and catches invalid provider tokens', async () => {
      const watchdog = new DriftProviderWatchdog();

      const healthyCheck = await watchdog.checkProviderHealth({
        provider: 'meta',
        tokenValid: true,
        schemaVersion: '20260904_v09_final',
      });
      expect(healthyCheck.healthy).toBe(true);
      expect(healthyCheck.driftDetected).toBe(false);

      const driftCheck = await watchdog.checkProviderHealth({
        provider: 'meta',
        tokenValid: false,
        schemaVersion: '20260801_outdated_schema',
      });
      expect(driftCheck.healthy).toBe(false);
      expect(driftCheck.driftDetected).toBe(true);
      expect(driftCheck.remedyAction).toBe('REFRESH_TOKEN_AND_RUN_MIGRATION');
    });
  });

  describe('ANI-683: 4-Step Deployment Protocol & Reversal Engine', () => {
    it('completes 4-stage rollout when all evidence gates pass', async () => {
      const deployer = new DeploymentReversalEngine();

      const result = await deployer.executeDeployment({
        version: 'v0.9.0-coupled-v0.4.0',
        stage1_snapshotSuccess: true,
        stage2_canaryErrorRate: 0.001, // 0.1% (< 1% threshold)
        stage3_evidenceGatePass: true,
      });

      expect(result.deploymentStage).toBe('STAGE_4_FULL_TRAFFIC');
      expect(result.status).toBe('DEPLOYED');
      expect(result.rolledBack).toBe(false);
    });

    it('triggers automatic rollback if canary or evidence gate fails', async () => {
      const deployer = new DeploymentReversalEngine();

      const failedResult = await deployer.executeDeployment({
        version: 'v0.9.0-failing-canary',
        stage1_snapshotSuccess: true,
        stage2_canaryErrorRate: 0.08, // 8% error rate (> 1% threshold)
        stage3_evidenceGatePass: false,
      });

      expect(failedResult.deploymentStage).toBe('ROLLED_BACK');
      expect(failedResult.status).toBe('REVERTED_TO_PREVIOUS_SNAPSHOT');
      expect(failedResult.rolledBack).toBe(true);
    });
  });

  describe('ANI-684 & ANI-685: Coupled Release Manifest & Release Gatekeeper', () => {
    it('blocks release if any Service V0.9 capability lacks Admin V0.4 observability', () => {
      const gatekeeper = new CoupledReleaseGatekeeper();

      // Flawed release: Service has MCP tool that Admin cannot observe/kill
      const uncoupledCapabilities = [
        { name: 'mcp_wildcard_execution', hasAdminObservability: false, hasKillSwitch: false },
      ];

      expect(() => {
        gatekeeper.validateCoupledParity(uncoupledCapabilities);
      }).toThrow(/Coupled Release Violation/);
    });

    it('approves coupled release when 100% of capabilities have Admin observability and produces E0~E4 manifest', () => {
      const gatekeeper = new CoupledReleaseGatekeeper();

      const coupledCapabilities = [
        { name: 'mcp_publish_live', hasAdminObservability: true, hasKillSwitch: true },
        { name: 'harness_compiler', hasAdminObservability: true, hasKillSwitch: true },
        { name: 'energy_ledger', hasAdminObservability: true, hasKillSwitch: true },
      ];

      const manifest = gatekeeper.generateCoupledReleaseManifest({
        serviceVersion: 'v0.9.0',
        adminVersion: 'v0.4.0',
        capabilities: coupledCapabilities,
      });

      expect(manifest.isApprovedForRelease).toBe(true);
      expect(manifest.evidenceTiersPassed).toEqual(['E0', 'E1', 'E2', 'E3', 'E4']);
      expect(manifest.releaseTag).toBe('sohee-v0.9.0-admin-v0.4.0-coupled');
    });

    it('rejects release approval if CI/CD check fails or is RED (ANI-709 Fail-Closed)', () => {
      const gatekeeper = new CoupledReleaseGatekeeper();
      const coupledCapabilities = [
        { name: 'mcp_publish_live', hasAdminObservability: true, hasKillSwitch: true },
      ];

      const manifest = gatekeeper.generateCoupledReleaseManifest({
        serviceVersion: 'v0.9.0',
        adminVersion: 'v0.4.0',
        capabilities: coupledCapabilities,
        ciPassed: false,
      });

      expect(manifest.isApprovedForRelease).toBe(false);
    });

    it('rejects release approval if evidence artifacts use mock or dummy sources (ANI-709 No-Mock Gate)', () => {
      const gatekeeper = new CoupledReleaseGatekeeper();
      const coupledCapabilities = [
        { name: 'mcp_publish_live', hasAdminObservability: true, hasKillSwitch: true },
      ];

      const flawedArtifacts = [
        { tier: 'E0' as const, description: 'Typecheck', sourceUri: 'ci://real-runner', verified: true },
        { tier: 'E1' as const, description: 'Behavioral', sourceUri: 'db://real-test', verified: true },
        { tier: 'E2' as const, description: 'Migration', sourceUri: 'db://real-migration', verified: true },
        { tier: 'E3' as const, description: 'Fake Staging', sourceUri: 'mock://dummy-provider-outcome', verified: true },
        { tier: 'E4' as const, description: 'Production', sourceUri: 'cloudflare://deployments/verified', verified: true },
      ];

      const manifest = gatekeeper.generateCoupledReleaseManifest({
        serviceVersion: 'v0.9.0',
        adminVersion: 'v0.4.0',
        capabilities: coupledCapabilities,
        evidenceArtifacts: flawedArtifacts,
      });

      expect(manifest.isApprovedForRelease).toBe(false);
      expect(manifest.evidenceTiersPassed).not.toContain('E3');
    });
  });

  describe('ANI-698: Admin Emergency Operations Drill', () => {
    it('executes emergency drill: engages kill-switch, kills browser session, and revokes tokens under 1 second', async () => {
      const drill = new AdminEmergencyDrillSimulator();

      const drillResult = await drill.runDrill({
        drillId: 'drill_security_p0_001',
        simulatedThreat: 'ANOMALOUS_RUNAWAY_PROMOTION',
        workspaceId: mockWorkspaceId,
        browserSessionId: 'browser_sandboxed_proc_882',
        providerToken: 'mock_meta_leaked_token_77',
      });

      expect(drillResult.killSwitchEngaged).toBe(true);
      expect(drillResult.browserTerminated).toBe(true);
      expect(drillResult.tokenRevoked).toBe(true);
      expect(drillResult.elapsedMs).toBeLessThan(1000);
      expect(drillResult.postMortemHash).toBeDefined();
    });
  });
});
