import type { AgentEnergyPlanTier } from '@/types/autonomous-outcome-os';
import type {
  ChatToolbeltSnapshot,
  ChatToolbeltItem,
  SoheePluginManifest,
} from '@/types/plugin-platform';
import { PluginInstallationService } from '../core/plugin-installation-service';
import { FIRST_PARTY_PLUGIN_CATALOG } from '../core/first-party-plugin-catalog';

export class ChatToolbeltService {
  private installService: PluginInstallationService;
  private catalog: SoheePluginManifest[];

  constructor(installService?: PluginInstallationService, catalog?: SoheePluginManifest[]) {
    this.installService = installService || new PluginInstallationService();
    this.catalog = catalog || FIRST_PARTY_PLUGIN_CATALOG;
  }

  /**
   * Generates a real-time Chat Toolbelt Snapshot for a workspace (ANI-781)
   * Groups plugins into READY, ACTION_REQUIRED, and PLAN_LOCKED chips.
   */
  generateToolbeltSnapshot(
    workspaceId: string,
    currentPlanTier: AgentEnergyPlanTier
  ): ChatToolbeltSnapshot {
    const installedList = this.installService.listWorkspaceInstallations(workspaceId);
    const installedMap = new Map(installedList.map((i) => [i.pluginId, i]));

    const readyItems: ChatToolbeltItem[] = [];
    const actionRequiredItems: ChatToolbeltItem[] = [];
    const planLockedItems: ChatToolbeltItem[] = [];

    for (const manifest of this.catalog) {
      const inst = installedMap.get(manifest.pluginId);

      if (inst) {
        const item: ChatToolbeltItem = {
          pluginId: manifest.pluginId,
          displayName: manifest.displayName,
          icon: manifest.icon,
          state: inst.state,
          healthStatus: inst.healthStatus,
          isReadyToCall: inst.state === 'READY' && !inst.isCircuitBreakerOpen,
          capabilities: manifest.capabilities.map((c) => c.name),
          riskTierBadge: manifest.capabilities[0]?.actionRiskTier || 'R0_LOW',
          approvalMode: inst.approvalMode,
          estimatedCreditImpact: manifest.minPlanTier === 'TIER_300K_GROWTH' ? 'HIGH' : 'MEDIUM',
        };

        if (inst.state === 'READY' && !inst.isCircuitBreakerOpen) {
          readyItems.push(item);
        } else {
          actionRequiredItems.push(item);
        }
      } else {
        // Not installed: check if plan locked
        const userRank = currentPlanTier === 'FREE_TASTE' ? 0 : currentPlanTier === 'TIER_150K_STARTER' ? 1 : 2;
        const reqRank = manifest.minPlanTier === 'FREE_TASTE' ? 0 : manifest.minPlanTier === 'TIER_150K_STARTER' ? 1 : 2;

        if (userRank < reqRank) {
          planLockedItems.push({
            pluginId: manifest.pluginId,
            displayName: manifest.displayName,
            icon: manifest.icon,
            state: 'PLAN_LOCKED',
            healthStatus: 'HEALTHY',
            isReadyToCall: false,
            capabilities: manifest.capabilities.map((c) => c.name),
            riskTierBadge: manifest.capabilities[0]?.actionRiskTier || 'R1_MODERATE',
            approvalMode: manifest.approvalDefault,
            estimatedCreditImpact: 'HIGH',
          });
        }
      }
    }

    return {
      workspaceId,
      generatedAt: new Date().toISOString(),
      readyItems,
      actionRequiredItems,
      planLockedItems,
      totalAvailableToolsCount: readyItems.reduce((acc, item) => acc + item.capabilities.length, 0),
    };
  }

  /**
   * Two-stage lazy tool schema expansion (ANI-781 & ANI-760)
   * Only returns schemas for plugins that match user intent and are currently READY.
   */
  selectRelevantToolSchemas(
    goalIntent: string,
    snapshot: ChatToolbeltSnapshot
  ): { selectedPluginIds: string[]; expandedTools: string[] } {
    const goalLower = goalIntent.toLowerCase();

    const selectedPlugins = snapshot.readyItems.filter((item) => {
      const nameMatch = item.displayName.toLowerCase().includes(goalLower);
      const capMatch = item.capabilities.some((c) => goalLower.includes(c.toLowerCase()) || c.toLowerCase().includes(goalLower));
      return nameMatch || capMatch;
    });

    const fallbackSelection = selectedPlugins.length > 0 ? selectedPlugins : snapshot.readyItems.slice(0, 3);

    return {
      selectedPluginIds: fallbackSelection.map((p) => p.pluginId),
      expandedTools: fallbackSelection.flatMap((p) => p.capabilities),
    };
  }
}
