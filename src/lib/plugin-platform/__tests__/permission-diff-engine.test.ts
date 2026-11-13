import { describe, it, expect, beforeEach } from 'vitest'
import {
  PermissionDiffEngine,
  type PermissionDiffReport,
} from '../governance/permission-diff-engine'
import type { SoheePluginManifest } from '@/types/plugin-platform'

describe('Plugin Permission Diff & Re-consent Engine (ANI-808)', () => {
  let engine: PermissionDiffEngine

  const v1Manifest: SoheePluginManifest = {
    pluginId: 'plg_blog_writer',
    slug: 'blog-writer',
    displayName: '블로그 콘텐츠 작성기',
    version: '1.0.0',
    publisherId: 'pub_sohee',
    publisherType: 'SOHEE',
    summary: '초안 작성 도구',
    categories: ['Content'],
    outcomeTags: ['블로그 작성'],
    icon: 'FileText',
    trustTier: 'SOHEE_CORE',
    minPlanTier: 'FREE_TASTE',
    entitlementKey: 'ent_content',
    capabilities: [
      {
        capabilityId: 'cap_draft_blog',
        name: '블로그 초안 작성',
        description: '블로그 글 초안 작성',
        actionRiskTier: 'R0_LOW',
        riskClass: 'READ',
        requiredScopes: ['blog:read'],
        creditCostWeight: 1,
        supportsIdempotency: true,
        requiresExternalVerification: false,
      },
    ],
    requiredScopes: ['blog:read'],
    approvalDefault: 'ALWAYS_ASK',
    creditMeteringPolicyId: 'meter_basic',
  }

  const v2ManifestExpanded: SoheePluginManifest = {
    ...v1Manifest,
    version: '2.0.0',
    capabilities: [
      ...v1Manifest.capabilities,
      {
        capabilityId: 'cap_publish_blog',
        name: '네이버 블로그 실발행',
        description: '네이버 공식 블로그에 글 즉시 발행',
        actionRiskTier: 'R2_CRITICAL',
        riskClass: 'WRITE',
        requiredScopes: ['blog:read', 'blog:write', 'naver:publish'],
        creditCostWeight: 2,
        supportsIdempotency: true,
        requiresExternalVerification: true,
      },
    ],
    requiredScopes: ['blog:read', 'blog:write', 'naver:publish'],
  }

  beforeEach(() => {
    engine = new PermissionDiffEngine()
  })

  it('detects scope enlargement and high risk escalation from READ to WRITE', () => {
    const report: PermissionDiffReport = engine.computePermissionDiff(
      'ws-test',
      v2ManifestExpanded,
      v1Manifest
    )

    expect(report.requiresReconsent).toBe(true)
    expect(report.isExecutionBlocked).toBe(true)
    expect(report.scopeDiff.added).toContain('blog:write')
    expect(report.scopeDiff.added).toContain('naver:publish')
    expect(report.hasHighRiskEscalation).toBe(true)
    expect(report.summaryCopy).toContain('사장님 재동의 필요')
  })

  it('allows execution once explicit owner re-consent is granted', () => {
    // 1. Initial check fails
    let report = engine.computePermissionDiff('ws-test', v2ManifestExpanded, v1Manifest)
    expect(report.requiresReconsent).toBe(true)

    // 2. Owner grants re-consent
    engine.grantConsent('ws-test', 'plg_blog_writer', v2ManifestExpanded, 'user_owner_1')

    // 3. Re-check diff against active consent
    report = engine.computePermissionDiff('ws-test', v2ManifestExpanded)
    expect(report.requiresReconsent).toBe(false)
    expect(report.isExecutionBlocked).toBe(false)
    expect(report.summaryCopy).toBe('권한 변경 없음 (기존 동의 유지)')
  })
})
