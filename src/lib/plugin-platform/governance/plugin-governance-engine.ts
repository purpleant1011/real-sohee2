import type { SoheePluginManifest } from '@/types/plugin-platform';

export type WorkspacePluginRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export type PluginGovernanceAction =
  | 'INSTALL_PLUGIN'
  | 'CONNECT_ACCOUNT'
  | 'APPROVE_WRITE'
  | 'APPROVE_SPEND'
  | 'DISABLE_PLUGIN'
  | 'UNINSTALL_PLUGIN';

export class PluginGovernanceEngine {
  private static readonly ROLE_PERMISSIONS: Record<WorkspacePluginRole, PluginGovernanceAction[]> = {
    OWNER: [
      'INSTALL_PLUGIN',
      'CONNECT_ACCOUNT',
      'APPROVE_WRITE',
      'APPROVE_SPEND',
      'DISABLE_PLUGIN',
      'UNINSTALL_PLUGIN',
    ],
    ADMIN: [
      'INSTALL_PLUGIN',
      'CONNECT_ACCOUNT',
      'APPROVE_WRITE',
      'DISABLE_PLUGIN',
    ],
    MEMBER: ['APPROVE_WRITE'],
    VIEWER: [],
  };

  /**
   * Enforces Workspace RBAC on Plugin Management (ANI-793)
   */
  enforceRbac(role: WorkspacePluginRole, action: PluginGovernanceAction): {
    allowed: boolean;
    reason?: string;
  } {
    const allowedActions = PluginGovernanceEngine.ROLE_PERMISSIONS[role] || [];
    if (!allowedActions.includes(action)) {
      return {
        allowed: false,
        reason: `Role [${role}] does not have permission to perform [${action}]. Requires higher privilege.`,
      };
    }
    return { allowed: true };
  }

  /**
   * Validates plugin dependency DAG and detects circular dependencies (ANI-793)
   */
  validateDependencies(
    targetManifest: SoheePluginManifest,
    installedPluginIds: string[],
    catalog: SoheePluginManifest[]
  ): { isValid: boolean; missingDependencies: string[]; reason?: string } {
    const reqs = targetManifest.requiredPlugins || [];
    const missing = reqs.filter((reqId) => !installedPluginIds.includes(reqId));

    if (missing.length > 0) {
      return {
        isValid: false,
        missingDependencies: missing,
        reason: `Required prerequisite plugins are missing: [${missing.join(', ')}]. Install them first.`,
      };
    }

    // Check circular dependencies
    const visited = new Set<string>();
    const stack = new Set<string>();

    const hasCycle = (pluginId: string): boolean => {
      visited.add(pluginId);
      stack.add(pluginId);

      const m = catalog.find((p) => p.pluginId === pluginId);
      const dependencies = m?.requiredPlugins || [];

      for (const dep of dependencies) {
        if (!visited.has(dep) && hasCycle(dep)) {
          return true;
        }
        if (stack.has(dep)) {
          return true;
        }
      }

      stack.delete(pluginId);
      return false;
    };

    if (hasCycle(targetManifest.pluginId)) {
      return {
        isValid: false,
        missingDependencies: [],
        reason: `Circular dependency detected involving plugin [${targetManifest.pluginId}].`,
      };
    }

    return { isValid: true, missingDependencies: [] };
  }
}
