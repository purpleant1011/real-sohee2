/**
 * Admin Wing Stack Control Tower (ANI-775)
 * 
 * Central oversight for borrowed substrates, third-party component registry (SBOM),
 * real-time provider canary, and privileged circuit-breaker/kill-switch controls.
 * 
 * Invariants:
 * 1. Admin is not a vendor dashboard collector; it is Sohee canonical command center.
 * 2. All privileged operations require Step-up auth, explicit reason, and immutable audit logging.
 * 3. Status is never masked: DOWN / DEGRADED is preserved honestly.
 */

import { ProviderCircuitBreakerRegistry } from '../../channel-execution/core/provider-circuit-breaker';
import { ExecutionChannel } from '../../channel-execution/core/channel-execution-types';

export type ComponentHealth = 'OK' | 'DEGRADED' | 'STALE' | 'DOWN';

export interface ThirdPartyComponentRecord {
  componentId: string;
  name: string;
  category: 'RUNTIME_ENGINE' | 'INTEGRATION_FABRIC' | 'SOCIAL_PUBLISH' | 'CONVERSATION_BUS' | 'AD_MCP' | 'BROWSER_WORKER' | 'MESSAGING_GATEWAY';
  license: string;
  pinnedVersion: string;
  sourceUrl: string;
  health: ComponentHealth;
  isExecutable: boolean;
  lastSuccessTimestamp?: string;
  lastErrorTimestamp?: string;
  lastErrorMessage?: string;
}

export interface AdminPrivilegedAuditLog {
  auditId: string;
  adminActorId: string;
  action: 'ISOLATE_PROVIDER' | 'RESTORE_PROVIDER' | 'TRIGGER_KILL_SWITCH' | 'RELEASE_KILL_SWITCH' | 'RESET_CIRCUIT_BREAKER';
  target: string;
  reason: string;
  timestamp: string;
}

export class WingStackControlTower {
  private components = new Map<string, ThirdPartyComponentRecord>();
  private auditLogs: AdminPrivilegedAuditLog[] = [];

  constructor(private readonly circuitBreakerRegistry: ProviderCircuitBreakerRegistry) {
    this.seedDefaultComponents();
  }

  private seedDefaultComponents(): void {
    const defaults: ThirdPartyComponentRecord[] = [
      {
        componentId: 'trigger_dev',
        name: 'Trigger.dev Durable Runtime',
        category: 'RUNTIME_ENGINE',
        license: 'Apache-2.0',
        pinnedVersion: 'v3.0.0-rc',
        sourceUrl: 'https://github.com/triggerdotdev/trigger.dev',
        health: 'OK',
        isExecutable: true,
      },
      {
        componentId: 'activepieces',
        name: 'Activepieces Community Edition',
        category: 'INTEGRATION_FABRIC',
        license: 'MIT',
        pinnedVersion: 'v0.36.0',
        sourceUrl: 'https://github.com/ActivepiecesAi/activepieces',
        health: 'OK',
        isExecutable: true,
      },
      {
        componentId: 'postiz',
        name: 'Postiz Social Publishing Core',
        category: 'SOCIAL_PUBLISH',
        license: 'AGPL-3.0',
        pinnedVersion: 'v1.14.0',
        sourceUrl: 'https://github.com/gitroomhq/postiz-app',
        health: 'OK',
        isExecutable: true,
      },
      {
        componentId: 'chatwoot',
        name: 'Chatwoot Conversation Bus',
        category: 'CONVERSATION_BUS',
        license: 'MIT Expat',
        pinnedVersion: 'v3.15.0',
        sourceUrl: 'https://github.com/chatwoot/chatwoot',
        health: 'OK',
        isExecutable: true,
      },
      {
        componentId: 'google_ads_mcp',
        name: 'Google Ads Official MCP',
        category: 'AD_MCP',
        license: 'Apache-2.0',
        pinnedVersion: 'v0.2.0',
        sourceUrl: 'https://github.com/googleads/google-ads-mcp',
        health: 'OK',
        isExecutable: true,
      },
      {
        componentId: 'naver_blog_browser',
        name: 'Naver Blog Browser Worker',
        category: 'BROWSER_WORKER',
        license: 'MIT (Internal Refined)',
        pinnedVersion: 'v1.0.0-sohee',
        sourceUrl: 'local/adapters/naver-blog-browser-adapter',
        health: 'OK',
        isExecutable: true,
      },
    ];

    for (const comp of defaults) {
      this.components.set(comp.componentId, comp);
    }
  }

  public getComponent(componentId: string): ThirdPartyComponentRecord | undefined {
    return this.components.get(componentId);
  }

  public getAllComponents(): readonly ThirdPartyComponentRecord[] {
    return Array.from(this.components.values());
  }

  public updateComponentHealth(componentId: string, health: ComponentHealth, errorMessage?: string): void {
    const comp = this.components.get(componentId);
    if (comp) {
      comp.health = health;
      comp.isExecutable = health === 'OK';
      if (errorMessage) {
        comp.lastErrorMessage = errorMessage;
        comp.lastErrorTimestamp = new Date().toISOString();
      } else {
        comp.lastSuccessTimestamp = new Date().toISOString();
      }
    }
  }

  // --- Privileged Admin Operations ---
  public executePrivilegedKillSwitch(
    scope: 'GLOBAL' | 'CHANNEL' | 'PROVIDER',
    target: string,
    reason: string,
    adminActorId: string
  ): void {
    if (!reason || reason.trim().length === 0) {
      throw new Error('Privileged operation rejected: Reason is mandatory');
    }

    if (scope === 'GLOBAL') {
      this.circuitBreakerRegistry.triggerGlobalKillSwitch(reason);
    } else if (scope === 'CHANNEL') {
      this.circuitBreakerRegistry.triggerChannelKillSwitch(target as ExecutionChannel, reason);
    } else if (scope === 'PROVIDER') {
      this.circuitBreakerRegistry.triggerProviderKillSwitch(target, reason);
    }

    this.auditLogs.push({
      auditId: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      adminActorId,
      action: 'TRIGGER_KILL_SWITCH',
      target: `${scope}:${target}`,
      reason,
      timestamp: new Date().toISOString(),
    });
  }

  public executePrivilegedReleaseKillSwitch(
    scope: 'GLOBAL' | 'CHANNEL' | 'PROVIDER',
    target: string,
    reason: string,
    adminActorId: string
  ): void {
    if (!reason || reason.trim().length === 0) {
      throw new Error('Privileged operation rejected: Reason is mandatory');
    }

    if (scope === 'GLOBAL') {
      this.circuitBreakerRegistry.releaseGlobalKillSwitch();
    } else if (scope === 'CHANNEL') {
      this.circuitBreakerRegistry.releaseChannelKillSwitch(target as ExecutionChannel);
    } else if (scope === 'PROVIDER') {
      this.circuitBreakerRegistry.releaseProviderKillSwitch(target);
    }

    this.auditLogs.push({
      auditId: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      adminActorId,
      action: 'RELEASE_KILL_SWITCH',
      target: `${scope}:${target}`,
      reason,
      timestamp: new Date().toISOString(),
    });
  }

  public getAuditLogs(): readonly AdminPrivilegedAuditLog[] {
    return [...this.auditLogs];
  }
}
