import type {
  PluginRoutingDecision,
  SoheePluginManifest,
} from '@/types/plugin-platform';
import { PluginInstallationService } from '../core/plugin-installation-service';
import { FIRST_PARTY_PLUGIN_CATALOG } from '../core/first-party-plugin-catalog';

export class PluginRouter {
  private installService: PluginInstallationService;
  private catalog: SoheePluginManifest[];

  constructor(installService?: PluginInstallationService, catalog?: SoheePluginManifest[]) {
    this.installService = installService || new PluginInstallationService();
    this.catalog = catalog || FIRST_PARTY_PLUGIN_CATALOG;
  }

  /**
   * Routes capability execution request against installed and READY plugins (ANI-780)
   * Enforces 11-point executable boundary.
   */
  routeCapability(params: {
    workspaceId: string;
    targetCapabilityId: string;
    hasSufficientCredits: boolean;
  }): PluginRoutingDecision {
    const { workspaceId, targetCapabilityId, hasSufficientCredits } = params;

    // 1. Find plugin manifest that provides this capability
    const candidateManifest = this.catalog.find((p) =>
      p.capabilities.some((c) => c.capabilityId === targetCapabilityId)
    );

    if (!candidateManifest) {
      return {
        allowed: false,
        reason: `시스템에 등록되지 않은 기능입니다: [${targetCapabilityId}]`,
      };
    }

    // 2. Check if installed in workspace
    const installation = this.installService.getInstalledPlugin(workspaceId, candidateManifest.pluginId);
    if (!installation) {
      return {
        allowed: false,
        reason: `[${candidateManifest.displayName}] 플러그인 설치가 필요합니다.`,
        missingPluginCandidate: candidateManifest,
      };
    }

    // 3. Check installation state
    if (installation.state === 'AUTH_REQUIRED') {
      return {
        allowed: false,
        reason: `[${candidateManifest.displayName}] 계정 연결 및 인증이 필요합니다.`,
        pluginId: candidateManifest.pluginId,
      };
    }

    if (installation.state === 'DEGRADED' || installation.isCircuitBreakerOpen) {
      return {
        allowed: false,
        reason: `[${candidateManifest.displayName}] 현재 외부 시스템 장애로 인해 일시 중단되었습니다. (Circuit Breaker OPEN)`,
        pluginId: candidateManifest.pluginId,
      };
    }

    if (installation.state !== 'READY') {
      return {
        allowed: false,
        reason: `[${candidateManifest.displayName}] 현재 준비 상태가 아닙니다 (${installation.state}).`,
        pluginId: candidateManifest.pluginId,
      };
    }

    // 4. Credit Preflight Check
    if (!hasSufficientCredits) {
      return {
        allowed: false,
        reason: '작업공간의 크레딧 잔여량이 부족합니다.',
        pluginId: candidateManifest.pluginId,
      };
    }

    return {
      allowed: true,
      pluginId: candidateManifest.pluginId,
      capabilityId: targetCapabilityId,
      provider: candidateManifest.publisherType,
    };
  }

  /**
   * Recommends missing plugins matching user goal keywords (ANI-781)
   */
  findPluginsForGoal(goalKeyword: string): SoheePluginManifest[] {
    const kw = goalKeyword.toLowerCase();
    return this.catalog.filter(
      (p) =>
        p.displayName.toLowerCase().includes(kw) ||
        p.summary.toLowerCase().includes(kw) ||
        p.outcomeTags.some((tag) => tag.toLowerCase().includes(kw)) ||
        p.categories.some((cat) => cat.toLowerCase().includes(kw))
    );
  }
}
