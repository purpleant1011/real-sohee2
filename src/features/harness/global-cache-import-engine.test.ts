import { describe, it, expect } from 'vitest'
import { globalCacheImportEngine } from './global-cache-import-engine'
import { HarnessAsset, HarnessVersion, HarnessRule } from '@/types/harness'

describe('GlobalCacheImportEngine (ANI-262)', () => {
  it('caches global snapshots across workspaces and respects TTL', () => {
    globalCacheImportEngine.setCachedSnapshot(
      'entity_studio_byreum',
      'https://instagram.com/studio_by.reum',
      { posts: ['post1', 'post2'] },
      24
    )

    const cached = globalCacheImportEngine.getCachedSnapshot('entity_studio_byreum')
    expect(cached).toBeDefined()
    expect(cached?.sourceEntityKey).toBe('entity_studio_byreum')
    expect(cached?.rawSnapshotData.posts.length).toBe(2)
  })

  it('imports seed reference into target workspace as an isolated private asset', () => {
    const seedAsset: HarnessAsset = {
      id: 'seed_byreum',
      workspaceId: 'system_global',
      assetType: 'ATOMIC_SOURCE',
      title: '바이름 뷰티 하네스',
      visibility: 'SYSTEM_SEED_REFERENCE',
      overallStatus: 'READY',
      activeVersionId: 'ver_seed_1',
      activeVersionNo: 1,
      platform: 'instagram',
      sourceUrl: 'https://instagram.com/studio_by.reum',
      coreDna: ['1:1 진단', '무통 시술'],
      moduleReadiness: { text: 'READY', visual: 'READY', operations: 'READY', community: 'READY', platform: 'READY' },
      dailyEstimatedSc: 100,
      totalSpentSc: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    const seedVersion: HarnessVersion = {
      id: 'ver_seed_1',
      harnessAssetId: 'seed_byreum',
      versionNo: 1,
      schemaVersion: '1.1.0',
      compilerVersion: 'sohee-luna-5.6',
      textJson: {} as any,
      visualJson: {} as any,
      operationsJson: {} as any,
      communityJson: {} as any,
      platformJson: {} as any,
      evidenceScore: 95,
      confidence: 90,
      immutable: true,
      createdAt: new Date().toISOString()
    }

    const seedRules: HarnessRule[] = [
      {
        id: 'rule_1',
        harnessVersionId: 'ver_seed_1',
        module: 'text',
        ruleKey: 'hook',
        ruleTitle: '공감 훅',
        ruleValue: '고민 공감',
        evidenceState: 'OBSERVED',
        supportingSampleCount: 5,
        contradictorySampleCount: 0,
        confidence: 90,
        confidenceBasis: '피드 분석'
      }
    ]

    const res = globalCacheImportEngine.importSeedToWorkspace(
      seedAsset,
      seedVersion,
      seedRules,
      'ws_tenant_99',
      'user_123'
    )

    expect(res.importedAsset.workspaceId).toBe('ws_tenant_99')
    expect(res.importedAsset.visibility).toBe('PRIVATE')
    expect(res.importedAsset.assetType).toBe('DERIVED_PRIVATE')
    expect(res.importedAsset.id).not.toBe(seedAsset.id)
    expect(res.importedVersion.harnessAssetId).toBe(res.importedAsset.id)
    expect(res.importedRules[0].harnessVersionId).toBe(res.importedVersion.id)
  })
})
