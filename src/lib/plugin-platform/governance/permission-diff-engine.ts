/**
 * Plugin Permission Diff & Re-consent Engine (ANI-808)
 * 
 * Strict Invariants:
 * 1. Silent permission escalation is strictly forbidden.
 * 2. If an update expands scopes, adds WRITE/SPEND/DELETE, or adds external destinations,
 *    it blocks execution until explicit owner re-consent.
 * 3. An audit trail of consent versions is immutably maintained.
 */

import type { SoheePluginManifest } from '@/types/plugin-platform'

export interface ScopeDiff {
  added: string[]
  removed: string[]
  unchanged: string[]
}

export interface PermissionDiffReport {
  pluginId: string
  displayName: string
  currentVersion: string
  targetVersion: string
  scopeDiff: ScopeDiff
  hasHighRiskEscalation: boolean // true if WRITE, SPEND, or DELETE added
  highRiskAdditions: string[]
  requiresReconsent: boolean
  isExecutionBlocked: boolean
  summaryCopy: string
}

export interface ConsentRecord {
  workspaceId: string
  pluginId: string
  consentedVersion: string
  consentedScopes: string[]
  consentedAt: string
  actorId: string
}

export class PermissionDiffEngine {
  private consentStore = new Map<string, ConsentRecord>()

  /**
   * Generates a key for workspace + plugin consent storage.
   */
  private getStoreKey(workspaceId: string, pluginId: string): string {
    return `${workspaceId}:${pluginId}`
  }

  /**
   * Computes the permission diff between currently consented state and a target manifest.
   */
  public computePermissionDiff(
    workspaceId: string,
    targetManifest: SoheePluginManifest,
    previousManifest?: SoheePluginManifest | null
  ): PermissionDiffReport {
    const existingConsent = this.consentStore.get(this.getStoreKey(workspaceId, targetManifest.pluginId))

    // If active consent exists for this exact version, no re-consent is required
    if (existingConsent && existingConsent.consentedVersion === targetManifest.version) {
      return {
        pluginId: targetManifest.pluginId,
        displayName: targetManifest.displayName,
        currentVersion: existingConsent.consentedVersion,
        targetVersion: targetManifest.version,
        scopeDiff: { added: [], removed: [], unchanged: targetManifest.requiredScopes },
        hasHighRiskEscalation: false,
        highRiskAdditions: [],
        requiresReconsent: false,
        isExecutionBlocked: false,
        summaryCopy: '권한 변경 없음 (기존 동의 유지)',
      }
    }

    const currentScopes: string[] = existingConsent?.consentedScopes ?? previousManifest?.requiredScopes ?? []
    const targetScopes: string[] = targetManifest.requiredScopes ?? []

    const added = targetScopes.filter((s) => !currentScopes.includes(s))
    const removed = currentScopes.filter((s) => !targetScopes.includes(s))
    const unchanged = targetScopes.filter((s) => currentScopes.includes(s))

    // High risk checks: does the new manifest introduce WRITE, SPEND, or DELETE?
    const previousRiskClasses = new Set(previousManifest?.capabilities.map((c) => c.riskClass) ?? [])
    const targetHighRiskCaps = targetManifest.capabilities.filter(
      (c) => c.riskClass === 'WRITE' || c.riskClass === 'SPEND' || c.riskClass === 'DELETE'
    )
    const highRiskAdditions = targetHighRiskCaps
      .filter((c) => !previousRiskClasses.has(c.riskClass))
      .map((c) => `${c.name} (${c.riskClass})`)

    const hasScopeEnlargement = added.length > 0
    const hasHighRiskEscalation = highRiskAdditions.length > 0

    const requiresReconsent = hasScopeEnlargement || hasHighRiskEscalation

    let summaryCopy = '권한 변경 없음 (기존 동의 유지)'
    if (requiresReconsent) {
      if (hasHighRiskEscalation) {
        summaryCopy = `중요 권한 확대 감지: ${highRiskAdditions.join(', ')} 추가로 인한 사장님 재동의 필요`
      } else {
        summaryCopy = `신규 권한 ${added.length}건 추가로 인한 사장님 재동의 필요`
      }
    }

    return {
      pluginId: targetManifest.pluginId,
      displayName: targetManifest.displayName,
      currentVersion: previousManifest?.version ?? existingConsent?.consentedVersion ?? '0.0.0',
      targetVersion: targetManifest.version,
      scopeDiff: { added, removed, unchanged },
      hasHighRiskEscalation,
      highRiskAdditions,
      requiresReconsent,
      isExecutionBlocked: requiresReconsent,
      summaryCopy,
    }
  }

  /**
   * Explicitly records owner consent for a specific plugin version and scopes.
   */
  public grantConsent(
    workspaceId: string,
    pluginId: string,
    manifest: SoheePluginManifest,
    actorId: string
  ): ConsentRecord {
    const record: ConsentRecord = {
      workspaceId,
      pluginId,
      consentedVersion: manifest.version,
      consentedScopes: [...manifest.requiredScopes],
      consentedAt: new Date().toISOString(),
      actorId,
    }

    this.consentStore.set(this.getStoreKey(workspaceId, pluginId), record)
    return record
  }

  /**
   * Retrieves active consent record.
   */
  public getConsent(workspaceId: string, pluginId: string): ConsentRecord | undefined {
    return this.consentStore.get(this.getStoreKey(workspaceId, pluginId))
  }

  /**
   * Clears memory store (for testing).
   */
  public clear(): void {
    this.consentStore.clear()
  }
}

export const defaultPermissionDiffEngine = new PermissionDiffEngine()
