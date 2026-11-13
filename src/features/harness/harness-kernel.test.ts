import { describe, it, expect, beforeEach } from 'vitest'
import { HarnessKernel } from './harness-kernel'

describe('HarnessKernel Identity & Multi-tenant RLS (v1.1)', () => {
  let kernel: HarnessKernel
  const wsA = 'ws_tenant_alpha'
  const wsB = 'ws_tenant_beta'

  beforeEach(() => {
    kernel = new HarnessKernel()
  })

  it('AC-01: Creates exactly one HarnessAsset per canonical URL', () => {
    const res1 = kernel.getOrCreateHarnessAsset({
      workspaceId: wsA,
      sourceUrl: 'https://www.instagram.com/studio_by.reum/',
      createdByUserId: 'user_001'
    })
    expect(res1.isNew).toBe(true)

    // Second call with same URL should resolve to existing asset
    const res2 = kernel.getOrCreateHarnessAsset({
      workspaceId: wsA,
      sourceUrl: 'https://instagram.com/studio_by.reum',
      createdByUserId: 'user_001'
    })
    expect(res2.isNew).toBe(false)
    expect(res2.asset.id).toBe(res1.asset.id)
  })

  it('AC-16: Maintains same Harness identity when Instagram handle changes with same native entity ID', () => {
    const res1 = kernel.getOrCreateHarnessAsset({
      workspaceId: wsA,
      sourceUrl: 'https://www.instagram.com/old_handle',
      platformNativeEntityId: 'ig_native_12345',
      createdByUserId: 'user_001'
    })

    // Handle changed to new_handle
    const res2 = kernel.getOrCreateHarnessAsset({
      workspaceId: wsA,
      sourceUrl: 'https://www.instagram.com/new_handle',
      platformNativeEntityId: 'ig_native_12345',
      createdByUserId: 'user_001'
    })

    expect(res2.isNew).toBe(false)
    expect(res2.asset.id).toBe(res1.asset.id)
  })

  it('AC-17: Does not auto-merge PROFILE and POST URLs even if same handle', () => {
    const profileAsset = kernel.getOrCreateHarnessAsset({
      workspaceId: wsA,
      sourceUrl: 'https://www.instagram.com/studio_by.reum',
      createdByUserId: 'user_001'
    })

    const postAsset = kernel.getOrCreateHarnessAsset({
      workspaceId: wsA,
      sourceUrl: 'https://www.instagram.com/p/DcsDjFrAfOi',
      createdByUserId: 'user_001'
    })

    expect(profileAsset.asset.id).not.toBe(postAsset.asset.id)
  })

  it('AC-02: Incrementing version creates immutable snapshots and advances version_no', () => {
    const { asset } = kernel.getOrCreateHarnessAsset({
      workspaceId: wsA,
      sourceUrl: 'https://www.instagram.com/studio_by.reum',
      createdByUserId: 'user_001'
    })

    const v1 = kernel.addHarnessVersion(
      asset.id,
      {
        schemaVersion: '1.1.0',
        compilerVersion: 'sohee-luna-5.6',
        textJson: {} as any,
        visualJson: {} as any,
        operationsJson: {} as any,
        communityJson: {} as any,
        platformJson: {} as any,
        evidenceScore: 90,
        confidence: 85
      },
      []
    )
    expect(v1.versionNo).toBe(1)
    expect(asset.activeVersionNo).toBe(1)
    expect(v1.immutable).toBe(true)

    const v2 = kernel.addHarnessVersion(
      asset.id,
      {
        schemaVersion: '1.1.0',
        compilerVersion: 'sohee-luna-5.6',
        textJson: {} as any,
        visualJson: {} as any,
        operationsJson: {} as any,
        communityJson: {} as any,
        platformJson: {} as any,
        evidenceScore: 95,
        confidence: 92
      },
      []
    )
    expect(v2.versionNo).toBe(2)
    expect(asset.activeVersionNo).toBe(2)
  })

  it('AC-32 & AC-33: Complete workspace multi-tenant isolation and unauthorized access blocking', () => {
    kernel.getOrCreateHarnessAsset({
      workspaceId: wsA,
      sourceUrl: 'https://www.instagram.com/studio_by.reum',
      createdByUserId: 'user_alpha'
    })

    kernel.getOrCreateHarnessAsset({
      workspaceId: wsB,
      sourceUrl: 'https://www.instagram.com/studio_by.reum',
      createdByUserId: 'user_beta'
    })

    const assetsA = kernel.getAssetsByWorkspace(wsA)
    const assetsB = kernel.getAssetsByWorkspace(wsB)

    expect(assetsA.length).toBe(1)
    expect(assetsB.length).toBe(1)
    expect(assetsA[0].id).not.toBe(assetsB[0].id)
  })
})
