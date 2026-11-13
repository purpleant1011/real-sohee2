/**
 * SOHEE Harness Knowledge OS — Global Cache & Seed Import Engine (v1.1)
 * Enforces:
 * 1. Global Acquisition Cache for public crawls (save credit across workspaces)
 * 2. Strict isolation for Workspace Private assets (Overrides, Brand Facts, Analytics)
 * 3. Seed Reference Import into private workspace as mutable version (AC-33, AC-45)
 */

import { HarnessAsset, HarnessVersion, HarnessRule } from '@/types/harness'

export interface GlobalCacheEntry {
  sourceEntityKey: string
  normalizedUrl: string
  cachedAt: string
  ttlExpiresAt: string
  rawSnapshotData: any
}

export class GlobalCacheImportEngine {
  private globalCache = new Map<string, GlobalCacheEntry>()

  /**
   * 1. Global Acquisition Cache 저장 & 조회
   */
  public getCachedSnapshot(sourceEntityKey: string): GlobalCacheEntry | undefined {
    const entry = this.globalCache.get(sourceEntityKey)
    if (!entry) return undefined
    if (Date.now() > new Date(entry.ttlExpiresAt).getTime()) {
      this.globalCache.delete(sourceEntityKey)
      return undefined
    }
    return entry
  }

  public setCachedSnapshot(sourceEntityKey: string, normalizedUrl: string, rawData: any, ttlHours = 24) {
    this.globalCache.set(sourceEntityKey, {
      sourceEntityKey,
      normalizedUrl,
      cachedAt: new Date().toISOString(),
      ttlExpiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString(),
      rawSnapshotData: rawData
    })
  }

  /**
   * 2. Seed Reference 하네스를 워크스페이스 전용 Private 하네스로 안전하게 복제/승격
   */
  public importSeedToWorkspace(
    seedAsset: HarnessAsset,
    seedVersion: HarnessVersion,
    seedRules: HarnessRule[],
    targetWorkspaceId: string,
    userId: string
  ): {
    importedAsset: HarnessAsset
    importedVersion: HarnessVersion
    importedRules: HarnessRule[]
  } {
    const newAssetId = `harness_import_${Date.now()}`
    const newVersionId = `ver_${newAssetId}_v1`

    const importedAsset: HarnessAsset = {
      ...seedAsset,
      id: newAssetId,
      workspaceId: targetWorkspaceId,
      visibility: 'PRIVATE', // 반드시 PRIVATE으로 강제
      assetType: 'DERIVED_PRIVATE',
      activeVersionId: newVersionId,
      activeVersionNo: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    const importedVersion: HarnessVersion = {
      ...seedVersion,
      id: newVersionId,
      harnessAssetId: newAssetId,
      versionNo: 1,
      immutable: true,
      createdAt: new Date().toISOString()
    }

    const importedRules: HarnessRule[] = seedRules.map(r => ({
      ...r,
      id: `rule_import_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      harnessVersionId: newVersionId
    }))

    return {
      importedAsset,
      importedVersion,
      importedRules
    }
  }
}

export const globalCacheImportEngine = new GlobalCacheImportEngine()
