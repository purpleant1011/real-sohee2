/**
 * SOHEE Harness Knowledge OS — Kernel & Identity Engine (v1.1)
 * Enforces:
 * 1. ONE SOURCE LINK = ONE ATOMIC HARNESS
 * 2. Multi-tenant Workspace RLS & Ownership Boundary
 * 3. Stable Source Entity Key & Handle History Tracking
 * 4. Immutable Version Snapshots & Active Pointers
 */

import {
  HarnessAsset,
  HarnessVersion,
  HarnessRule,
  HarnessSourceEntity,
  PlatformType,
  SourceType,
  HarnessStatus,
  EvidenceState
} from '@/types/harness'

export interface CreateHarnessAssetInput {
  workspaceId: string
  sourceUrl: string
  sourceType?: SourceType
  title?: string
  platformNativeEntityId?: string
  createdByUserId: string
}

export class HarnessKernel {
  private assets = new Map<string, HarnessAsset>()
  private sourceEntities = new Map<string, HarnessSourceEntity>()
  private versions = new Map<string, HarnessVersion>()
  private rules = new Map<string, HarnessRule[]>()

  /**
   * 1. URL 정규화 및 Platform / Source Type 감지
   */
  public normalizeUrl(rawUrl: string): {
    canonicalUrl: string
    platform: PlatformType
    sourceType: SourceType
    handle: string
    entityKey: string
  } {
    const trimmed = rawUrl.trim().replace(/\/+$/, '')
    let platform: PlatformType = 'generic'
    let sourceType: SourceType = 'PROFILE'
    let handle = 'unknown'

    try {
      const urlObj = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
      const hostname = urlObj.hostname.toLowerCase()
      const pathname = urlObj.pathname

      if (hostname.includes('instagram.com')) {
        platform = 'instagram'
        const parts = pathname.split('/').filter(Boolean)
        if (parts.length === 1) {
          sourceType = 'PROFILE'
          handle = parts[0]
        } else if (parts.includes('p') || parts.includes('reel')) {
          sourceType = 'POST'
          handle = parts[parts.length - 1]
        }
      } else if (hostname.includes('threads.net') || hostname.includes('threads.com')) {
        platform = 'threads'
        const parts = pathname.split('/').filter(Boolean)
        if (parts.length >= 1 && parts[0].startsWith('@')) {
          handle = parts[0].replace('@', '')
          sourceType = parts.includes('post') ? 'THREAD' : 'PROFILE'
        }
      } else if (hostname.includes('blog.naver.com')) {
        platform = 'naver_blog'
        const parts = pathname.split('/').filter(Boolean)
        if (parts.length >= 1) {
          handle = parts[0]
          sourceType = parts.length > 1 ? 'BLOG_ARTICLE' : 'PROFILE'
        }
      }
    } catch {
      handle = trimmed.split('/').filter(Boolean).pop() || 'unknown'
    }

    const canonicalUrl = trimmed.toLowerCase()
    const entityKey = `${platform}:${sourceType}:${handle.toLowerCase()}`

    return {
      canonicalUrl,
      platform,
      sourceType,
      handle,
      entityKey
    }
  }

  /**
   * 2. Source Entity 생성 또는 조회 (Handle 변경 시 Alias 추적)
   */
  public resolveSourceEntity(
    workspaceId: string,
    rawUrl: string,
    platformNativeEntityId?: string
  ): HarnessSourceEntity {
    const { canonicalUrl, platform, sourceType, handle, entityKey } = this.normalizeUrl(rawUrl)

    // Check existing by entityKey or nativeId within workspace
    for (const entity of this.sourceEntities.values()) {
      if (entity.workspaceId !== workspaceId) continue

      // Handle change matching with same native ID
      if (platformNativeEntityId && entity.platformNativeEntityId === platformNativeEntityId) {
        if (entity.sourceHandleCurrent !== handle) {
          entity.sourceHandleHistory.push(entity.sourceHandleCurrent)
          entity.sourceHandleCurrent = handle
        }
        if (!entity.sourceUrlAliases.includes(canonicalUrl)) {
          entity.sourceUrlAliases.push(canonicalUrl)
        }
        entity.canonicalUrlCurrent = canonicalUrl
        entity.resolvedAt = new Date().toISOString()
        return entity
      }

      // Exact entityKey match
      if (entity.sourceEntityKey === entityKey && entity.sourceType === sourceType) {
        if (!entity.sourceUrlAliases.includes(canonicalUrl)) {
          entity.sourceUrlAliases.push(canonicalUrl)
        }
        return entity
      }
    }

    // Create new Source Entity
    const newEntity: HarnessSourceEntity = {
      id: `entity_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      workspaceId,
      platform,
      sourceType,
      sourceEntityKey: entityKey,
      platformNativeEntityId,
      canonicalUrlCurrent: canonicalUrl,
      sourceUrlAliases: [canonicalUrl],
      sourceHandleCurrent: handle,
      sourceHandleHistory: [],
      resolvedAt: new Date().toISOString()
    }

    this.sourceEntities.set(newEntity.id, newEntity)
    return newEntity
  }

  /**
   * 3. HarnessAsset 생성 또는 버전 갱신 (ONE SOURCE LINK = ONE ATOMIC HARNESS)
   */
  public getOrCreateHarnessAsset(input: CreateHarnessAssetInput): {
    asset: HarnessAsset
    isNew: boolean
  } {
    const sourceEntity = this.resolveSourceEntity(
      input.workspaceId,
      input.sourceUrl,
      input.platformNativeEntityId
    )

    // Look for existing HarnessAsset for this Source Entity in this Workspace
    for (const existingAsset of this.assets.values()) {
      if (
        existingAsset.workspaceId === input.workspaceId &&
        existingAsset.sourceEntityId === sourceEntity.id
      ) {
        return { asset: existingAsset, isNew: false }
      }
    }

    // Create new HarnessAsset
    const assetId = `harness_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const newAsset: HarnessAsset = {
      id: assetId,
      workspaceId: input.workspaceId,
      assetType: 'ATOMIC_SOURCE',
      sourceEntityId: sourceEntity.id,
      title: input.title || `${sourceEntity.sourceHandleCurrent} 운영 하네스`,
      visibility: 'PRIVATE',
      overallStatus: 'DRAFT',
      activeVersionId: '',
      activeVersionNo: 0,
      platform: sourceEntity.platform,
      sourceUrl: sourceEntity.canonicalUrlCurrent,
      sourceHandle: sourceEntity.sourceHandleCurrent,
      coreDna: [],
      moduleReadiness: {
        text: 'PARTIAL',
        visual: 'PARTIAL',
        operations: 'PARTIAL',
        community: 'PARTIAL',
        platform: 'READY'
      },
      dailyEstimatedSc: 100,
      totalSpentSc: 0,
      lastAnalyzedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    this.assets.set(newAsset.id, newAsset)
    return { asset: newAsset, isNew: true }
  }

  /**
   * 4. Immutable Version 추가 및 Active Version 승격
   */
  public addHarnessVersion(
    assetId: string,
    versionData: Omit<HarnessVersion, 'id' | 'harnessAssetId' | 'versionNo' | 'immutable' | 'createdAt'>,
    rules: Omit<HarnessRule, 'id' | 'harnessVersionId'>[]
  ): HarnessVersion {
    const asset = this.assets.get(assetId)
    if (!asset) throw new Error(`HarnessAsset ${assetId} not found`)

    const newVersionNo = asset.activeVersionNo + 1
    const versionId = `ver_${assetId}_v${newVersionNo}`

    const newVersion: HarnessVersion = {
      ...versionData,
      id: versionId,
      harnessAssetId: assetId,
      versionNo: newVersionNo,
      immutable: true,
      createdAt: new Date().toISOString()
    }

    this.versions.set(versionId, newVersion)

    // Save rules
    const createdRules: HarnessRule[] = rules.map((r, idx) => ({
      ...r,
      id: `rule_${versionId}_${idx + 1}`,
      harnessVersionId: versionId
    }))
    this.rules.set(versionId, createdRules)

    // Update asset active version pointer
    asset.activeVersionId = versionId
    asset.activeVersionNo = newVersionNo
    asset.overallStatus = newVersion.confidence >= 80 ? 'READY' : 'PARTIAL'
    asset.updatedAt = new Date().toISOString()

    return newVersion
  }

  /**
   * 5. Workspace 격리 조회 (RLS 보장)
   */
  public getAssetsByWorkspace(workspaceId: string): HarnessAsset[] {
    return Array.from(this.assets.values()).filter(a => a.workspaceId === workspaceId)
  }

  public getVersion(versionId: string, workspaceId: string): HarnessVersion | undefined {
    const version = this.versions.get(versionId)
    if (!version) return undefined
    const asset = this.assets.get(version.harnessAssetId)
    if (!asset || asset.workspaceId !== workspaceId) {
      throw new Error(`Unauthorized access to version ${versionId} from workspace ${workspaceId}`)
    }
    return version
  }

  public getRules(versionId: string): HarnessRule[] {
    return this.rules.get(versionId) || []
  }
}

export const harnessKernel = new HarnessKernel()
