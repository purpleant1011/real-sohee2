import { describe, it, expect, beforeEach } from 'vitest';
import { FIRST_PARTY_PLUGIN_CATALOG } from '../core/first-party-plugin-catalog';
import { PluginInstallationService } from '../core/plugin-installation-service';
import { PluginRouter } from '../router/plugin-router';
import { ChatToolbeltService } from '../toolbelt/chat-toolbelt-service';
import { PluginGovernanceEngine } from '../governance/plugin-governance-engine';

describe('Wave 1 · Sohee Plugin Platform & Capability Fabric (ANI-780, 781, 785, 793)', () => {
  let installService: PluginInstallationService;
  let router: PluginRouter;
  let toolbeltService: ChatToolbeltService;
  let governanceEngine: PluginGovernanceEngine;

  beforeEach(() => {
    installService = new PluginInstallationService();
    router = new PluginRouter(installService, FIRST_PARTY_PLUGIN_CATALOG);
    toolbeltService = new ChatToolbeltService(installService, FIRST_PARTY_PLUGIN_CATALOG);
    governanceEngine = new PluginGovernanceEngine();
  });

  describe('Plugin Installation Lifecycle & Plan Gating (ANI-780)', () => {
    it('installs a starter plugin and sets state to AUTH_REQUIRED if scopes required', () => {
      const manifest = FIRST_PARTY_PLUGIN_CATALOG.find((p) => p.slug === 'instagram-growth')!;
      const result = installService.installPlugin({
        workspaceId: 'ws_01',
        manifest,
        currentPlanTier: 'TIER_150K_STARTER',
      });

      expect(result.success).toBe(true);
      expect(result.state).toBe('AUTH_REQUIRED');
      expect(result.installation?.healthStatus).toBe('HEALTHY');
    });

    it('blocks installation with PLAN_LOCKED when workspace plan tier is insufficient', () => {
      const manifest = FIRST_PARTY_PLUGIN_CATALOG.find((p) => p.slug === 'naver-search-ads-autopilot')!; // requires TIER_300K_GROWTH
      const result = installService.installPlugin({
        workspaceId: 'ws_free',
        manifest,
        currentPlanTier: 'FREE_TASTE',
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe('PLAN_LOCKED');
      expect(result.reason).toContain('TIER_300K_GROWTH');
    });

    it('advances plugin to READY upon account connection', () => {
      const manifest = FIRST_PARTY_PLUGIN_CATALOG.find((p) => p.slug === 'instagram-growth')!;
      installService.installPlugin({
        workspaceId: 'ws_01',
        manifest,
        currentPlanTier: 'TIER_150K_STARTER',
      });

      const readyPlugin = installService.markAccountConnected('ws_01', manifest.pluginId, 'act_insta_biz_999');
      expect(readyPlugin.state).toBe('READY');
      expect(readyPlugin.connectedAccountId).toBe('act_insta_biz_999');
    });

    it('degrades plugin when circuit breaker is opened', () => {
      const manifest = FIRST_PARTY_PLUGIN_CATALOG.find((p) => p.slug === 'instagram-growth')!;
      installService.installPlugin({
        workspaceId: 'ws_01',
        manifest,
        currentPlanTier: 'TIER_150K_STARTER',
      });
      installService.markAccountConnected('ws_01', manifest.pluginId, 'act_999');

      installService.setCircuitBreaker('ws_01', manifest.pluginId, true);
      const inst = installService.getInstalledPlugin('ws_01', manifest.pluginId);
      expect(inst?.state).toBe('DEGRADED');
      expect(inst?.isCircuitBreakerOpen).toBe(true);
    });
  });

  describe('Plugin Router (ANI-780 & ANI-760)', () => {
    it('successfully routes to capability when plugin is READY and credits sufficient', () => {
      const manifest = FIRST_PARTY_PLUGIN_CATALOG.find((p) => p.slug === 'instagram-growth')!;
      installService.installPlugin({
        workspaceId: 'ws_01',
        manifest,
        currentPlanTier: 'TIER_150K_STARTER',
      });
      installService.markAccountConnected('ws_01', manifest.pluginId, 'act_999');

      const decision = router.routeCapability({
        workspaceId: 'ws_01',
        targetCapabilityId: 'instagram.publish',
        hasSufficientCredits: true,
      });

      expect(decision.allowed).toBe(true);
      expect(decision.pluginId).toBe(manifest.pluginId);
      expect(decision.capabilityId).toBe('instagram.publish');
    });

    it('recommends missing plugin when requested capability is not installed', () => {
      const decision = router.routeCapability({
        workspaceId: 'ws_empty',
        targetCapabilityId: 'instagram.publish',
        hasSufficientCredits: true,
      });

      expect(decision.allowed).toBe(false);
      expect(decision.missingPluginCandidate?.slug).toBe('instagram-growth');
    });

    it('blocks execution when circuit breaker is open', () => {
      const manifest = FIRST_PARTY_PLUGIN_CATALOG.find((p) => p.slug === 'instagram-growth')!;
      installService.installPlugin({ workspaceId: 'ws_01', manifest, currentPlanTier: 'TIER_150K_STARTER' });
      installService.markAccountConnected('ws_01', manifest.pluginId, 'act_999');
      installService.setCircuitBreaker('ws_01', manifest.pluginId, true);

      const decision = router.routeCapability({
        workspaceId: 'ws_01',
        targetCapabilityId: 'instagram.publish',
        hasSufficientCredits: true,
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Circuit Breaker OPEN');
    });
  });

  describe('Chat Toolbelt Snapshot & 2-Stage Lazy Tool Loading (ANI-781)', () => {
    it('generates real-time Toolbelt snapshot categorizing READY, ACTION_REQUIRED, and PLAN_LOCKED', () => {
      const instaManifest = FIRST_PARTY_PLUGIN_CATALOG.find((p) => p.slug === 'instagram-growth')!;
      installService.installPlugin({ workspaceId: 'ws_user', manifest: instaManifest, currentPlanTier: 'TIER_150K_STARTER' });
      installService.markAccountConnected('ws_user', instaManifest.pluginId, 'act_1');

      const kakaoManifest = FIRST_PARTY_PLUGIN_CATALOG.find((p) => p.slug === 'kakao-consult-booking')!;
      installService.installPlugin({ workspaceId: 'ws_user', manifest: kakaoManifest, currentPlanTier: 'TIER_150K_STARTER' }); // remains AUTH_REQUIRED

      const snapshot = toolbeltService.generateToolbeltSnapshot('ws_user', 'TIER_150K_STARTER');

      expect(snapshot.readyItems.length).toBeGreaterThanOrEqual(1);
      expect(snapshot.readyItems[0].pluginId).toBe(instaManifest.pluginId);

      expect(snapshot.actionRequiredItems.length).toBeGreaterThanOrEqual(1);
      expect(snapshot.actionRequiredItems[0].pluginId).toBe(kakaoManifest.pluginId);

      expect(snapshot.planLockedItems.length).toBeGreaterThanOrEqual(1); // naver search ads is locked for Starter
    });

    it('selects relevant tool schemas based on user intent keywords (Lazy Loading)', () => {
      const instaManifest = FIRST_PARTY_PLUGIN_CATALOG.find((p) => p.slug === 'instagram-growth')!;
      installService.installPlugin({ workspaceId: 'ws_user', manifest: instaManifest, currentPlanTier: 'TIER_150K_STARTER' });
      installService.markAccountConnected('ws_user', instaManifest.pluginId, 'act_1');

      const snapshot = toolbeltService.generateToolbeltSnapshot('ws_user', 'TIER_150K_STARTER');

      const selection = toolbeltService.selectRelevantToolSchemas('인스타그램에 신메뉴 홍보해줘', snapshot);
      expect(selection.selectedPluginIds).toContain(instaManifest.pluginId);
      expect(selection.expandedTools.some((t) => t.includes('인스타그램'))).toBe(true);
    });
  });

  describe('Plugin Governance State Machine & RBAC (ANI-793)', () => {
    it('enforces RBAC permissions per workspace role', () => {
      expect(governanceEngine.enforceRbac('OWNER', 'APPROVE_SPEND').allowed).toBe(true);
      expect(governanceEngine.enforceRbac('ADMIN', 'APPROVE_SPEND').allowed).toBe(false);
      expect(governanceEngine.enforceRbac('MEMBER', 'INSTALL_PLUGIN').allowed).toBe(false);
      expect(governanceEngine.enforceRbac('VIEWER', 'APPROVE_WRITE').allowed).toBe(false);
    });

    it('blocks installation when prerequisite dependency plugins are missing', () => {
      const mockManifestWithDep = {
        ...FIRST_PARTY_PLUGIN_CATALOG[0],
        requiredPlugins: ['plg_core_engine_prerequisite'],
      };

      const res = governanceEngine.validateDependencies(mockManifestWithDep, ['plg_other'], FIRST_PARTY_PLUGIN_CATALOG);
      expect(res.isValid).toBe(false);
      expect(res.missingDependencies).toContain('plg_core_engine_prerequisite');
    });
  });
});
