import { describe, it, expect } from 'vitest';
import {
  PluginArtifactService,
  EMPTY_SHA256_DIGEST,
} from '@/lib/plugin-platform/core/plugin-artifact-service';
import { FIRST_PARTY_PLUGIN_CATALOG } from '@/lib/plugin-platform/core/first-party-plugin-catalog';
import type { SoheePluginManifest, WorkspaceInstalledPlugin } from '@/types/plugin-platform';

describe('ANI-922: Plugin READY Gate, Real Manifest/SBOM/Occupancy & Governance', () => {
  const sampleManifest = FIRST_PARTY_PLUGIN_CATALOG[0];

  function createMockInstallation(overrides: Partial<WorkspaceInstalledPlugin>): WorkspaceInstalledPlugin {
    return {
      installationId: 'inst_test_id',
      workspaceId: 'ws_1',
      pluginId: sampleManifest.pluginId,
      manifestVersion: sampleManifest.version,
      state: 'READY',
      installedAt: new Date().toISOString(),
      healthStatus: 'HEALTHY',
      lastHealthCheckedAt: new Date().toISOString(),
      approvalMode: 'GUARDED_AUTO',
      isCircuitBreakerOpen: false,
      ...overrides,
    };
  }

  describe('1. Artifact Verification & Empty Artifact Detection', () => {
    it('should strictly reject empty byte sequence with INVALID_EMPTY_ARTIFACT', () => {
      const emptyArtifact = PluginArtifactService.computeArtifactMetadata(sampleManifest, '');
      expect(emptyArtifact.signatureStatus).toBe('INVALID_EMPTY_ARTIFACT');
      expect(emptyArtifact.byteLength).toBe(0);
      expect(emptyArtifact.sha256).toBe(`sha256-${EMPTY_SHA256_DIGEST}`);
      expect(emptyArtifact.error).toBeDefined();

      const zeroBufferArtifact = PluginArtifactService.computeArtifactMetadata(sampleManifest, Buffer.alloc(0));
      expect(zeroBufferArtifact.signatureStatus).toBe('INVALID_EMPTY_ARTIFACT');
      expect(zeroBufferArtifact.byteLength).toBe(0);
    });

    it('should calculate valid, non-empty distinct SHA-256 digests for all 18 first-party plugins', () => {
      expect(FIRST_PARTY_PLUGIN_CATALOG.length).toBe(18);

      const catalog = PluginArtifactService.getAllVerifiedCatalog();
      expect(catalog.length).toBe(18);

      const digests = new Set<string>();
      for (const item of catalog) {
        expect(item.artifact.signatureStatus).toBe('VERIFIED');
        expect(item.artifact.byteLength).toBeGreaterThan(0);
        expect(item.artifact.sha256).not.toContain(EMPTY_SHA256_DIGEST);
        expect(item.artifact.sha256.startsWith('sha256-')).toBe(true);

        // All 18 plugins must have distinct digests
        expect(digests.has(item.artifact.sha256)).toBe(false);
        digests.add(item.artifact.sha256);
      }

      expect(digests.size).toBe(18);
    });
  });

  describe('2. Software Bill of Materials (SBOM) Generation', () => {
    it('should generate CycloneDX 1.5 format SBOM with deterministic hashes', () => {
      const sbom = PluginArtifactService.getPluginSbom(sampleManifest);

      expect(sbom.format).toBe('CycloneDX_1.5');
      expect(sbom.pluginId).toBe(sampleManifest.pluginId);
      expect(sbom.version).toBe(sampleManifest.version);
      expect(sbom.components.length).toBe(sampleManifest.capabilities.length);

      for (const comp of sbom.components) {
        expect(comp.name).toContain('@sohee-capability/');
        expect(comp.license).toBe('PROPRIETARY_SOHEE_E4');
        expect(comp.sha256).toBeDefined();
        expect(comp.sha256?.length).toBe(64);
      }
    });
  });

  describe('3. True Occupancy Calculation (Distinct Numerator & Denominator)', () => {
    it('should compute occupancy based only on eligible workspaces and actual installations', () => {
      const adsPlugin = FIRST_PARTY_PLUGIN_CATALOG.find((p) => p.pluginId === 'plg_google_ads_autopilot')!;
      expect(adsPlugin).toBeDefined();
      expect(adsPlugin.minPlanTier).toBe('TIER_300K_GROWTH');

      const workspaces = [
        { workspaceId: 'ws_free', planTier: 'FREE_TASTE' as const },
        { workspaceId: 'ws_starter', planTier: 'TIER_150K_STARTER' as const },
        { workspaceId: 'ws_growth_1', planTier: 'TIER_300K_GROWTH' as const },
        { workspaceId: 'ws_growth_2', planTier: 'TIER_300K_GROWTH' as const },
        { workspaceId: 'ws_pro', planTier: 'TIER_500K_PRO_SCALE' as const },
      ];

      // Eligible: ws_growth_1, ws_growth_2, ws_pro (3 total)
      // Installed: ws_free (ineligible, ignored in numerator), ws_growth_1 (eligible, counted)
      const installed = ['ws_free', 'ws_growth_1'];

      const occupancy = PluginArtifactService.calculateOccupancy(adsPlugin, workspaces, installed);

      expect(occupancy.eligibleWorkspacesCount).toBe(3);
      expect(occupancy.activeInstalledWorkspacesCount).toBe(1);
      expect(occupancy.occupancyRate).toBe(Number((1 / 3).toFixed(4)));
    });

    it('should handle zero eligible workspaces cleanly', () => {
      const proPlugin = FIRST_PARTY_PLUGIN_CATALOG.find((p) => p.minPlanTier === 'TIER_500K_PRO_SCALE') || sampleManifest;
      const occupancy = PluginArtifactService.calculateOccupancy(proPlugin, [], []);

      expect(occupancy.eligibleWorkspacesCount).toBe(0);
      expect(occupancy.activeInstalledWorkspacesCount).toBe(0);
      expect(occupancy.occupancyRate).toBe(0);
    });
  });

  describe('4. Scope Expansion & Drift Detection', () => {
    it('should detect when newly required scopes exceed previously consented scopes', () => {
      const consented = ['read:posts', 'read:insights'];
      const required = ['read:posts', 'read:insights', 'write:campaigns', 'spend:credits'];

      const drift = PluginArtifactService.detectScopeDrift(consented, required);

      expect(drift.reconsentRequired).toBe(true);
      expect(drift.addedScopes).toEqual(['write:campaigns', 'spend:credits']);
    });

    it('should allow subset or identical scopes without reconsent', () => {
      const consented = ['read:posts', 'read:insights', 'write:campaigns'];
      const required = ['read:posts'];

      const drift = PluginArtifactService.detectScopeDrift(consented, required);

      expect(drift.reconsentRequired).toBe(false);
      expect(drift.addedScopes).toEqual([]);
    });
  });

  describe('5. Operational Lifecycle Stage Evaluation (Fail-Closed Gates)', () => {
    it('Gate 1: should return BLOCKED if killed by admin or trustTier is BLOCKED', () => {
      const res = PluginArtifactService.evaluateOperationalStage({
        manifest: sampleManifest,
        currentPlanTier: 'TIER_500K_PRO_SCALE',
        isKilledByAdmin: true,
      });

      expect(res.stage).toBe('BLOCKED');
      expect(res.reason).toContain('BLOCKED');
    });

    it('Gate 2: should return PUBLISHED if current plan tier does not meet minimum requirement', () => {
      const growthPlugin = FIRST_PARTY_PLUGIN_CATALOG.find((p) => p.minPlanTier === 'TIER_300K_GROWTH')!;
      const res = PluginArtifactService.evaluateOperationalStage({
        manifest: growthPlugin,
        currentPlanTier: 'TIER_150K_STARTER',
      });

      expect(res.stage).toBe('PUBLISHED');
      expect(res.reason).toContain('사용 자격이 없습니다');
    });

    it('Gate 3: should return ELIGIBLE if plan is sufficient but plugin is not installed', () => {
      const starterPlugin = FIRST_PARTY_PLUGIN_CATALOG.find((p) => p.minPlanTier === 'TIER_150K_STARTER')!;
      const res = PluginArtifactService.evaluateOperationalStage({
        manifest: starterPlugin,
        currentPlanTier: 'TIER_300K_GROWTH',
        installation: null,
      });

      expect(res.stage).toBe('ELIGIBLE');
      expect(res.reason).toContain('설치 자격이 충족');
    });

    it('Gate 4: should return RECONSENT_REQUIRED if new scopes require consent', () => {
      const pluginWithScopes = FIRST_PARTY_PLUGIN_CATALOG.find((p) => p.requiredScopes.length > 1)!;
      const installation = createMockInstallation({
        pluginId: pluginWithScopes.pluginId,
        state: 'READY',
      });

      const res = PluginArtifactService.evaluateOperationalStage({
        manifest: pluginWithScopes,
        currentPlanTier: 'TIER_500K_PRO_SCALE',
        installation,
        previouslyConsentedScopes: [], // none consented yet
      });

      expect(res.stage).toBe('RECONSENT_REQUIRED');
    });

    it('Gate 5: should return INSTALLED (not READY) if WRITE/SPEND plugin has no external connected account', () => {
      const writePlugin = FIRST_PARTY_PLUGIN_CATALOG.find((p) =>
        p.capabilities.some((c) => c.riskClass === 'WRITE' || c.riskClass === 'SPEND')
      )!;

      const installation = createMockInstallation({
        pluginId: writePlugin.pluginId,
        state: 'AUTH_REQUIRED',
        connectedAccountId: undefined,
      });

      const res = PluginArtifactService.evaluateOperationalStage({
        manifest: writePlugin,
        currentPlanTier: 'TIER_500K_PRO_SCALE',
        installation,
      });

      expect(res.stage).toBe('INSTALLED');
      expect(res.reason).toContain('인증');
    });

    it('Gate 6: should return DEGRADED if circuit breaker is open or healthStatus is DEGRADED', () => {
      const installation = createMockInstallation({
        pluginId: sampleManifest.pluginId,
        state: 'READY',
        healthStatus: 'DEGRADED',
        isCircuitBreakerOpen: true,
        connectedAccountId: 'acc_test',
      });

      const res = PluginArtifactService.evaluateOperationalStage({
        manifest: sampleManifest,
        currentPlanTier: 'TIER_500K_PRO_SCALE',
        installation,
        isCircuitBreakerOpen: true,
      });

      expect(res.stage).toBe('DEGRADED');
      expect(res.reason).toContain('DEGRADED');
    });

    it('Gate 7: should return READY only when all gates pass with verified integrity', () => {
      const readPlugin = FIRST_PARTY_PLUGIN_CATALOG.find((p) =>
        p.capabilities.every((c) => c.riskClass === 'READ')
      ) || sampleManifest;

      const installation = createMockInstallation({
        pluginId: readPlugin.pluginId,
        state: 'READY',
        healthStatus: 'HEALTHY',
        isCircuitBreakerOpen: false,
        connectedAccountId: 'acc_123',
      });

      const res = PluginArtifactService.evaluateOperationalStage({
        manifest: readPlugin,
        currentPlanTier: 'TIER_500K_PRO_SCALE',
        installation,
        previouslyConsentedScopes: readPlugin.requiredScopes,
      });

      expect(res.stage).toBe('READY');
      expect(res.reason).toContain('READY');
    });
  });
});
