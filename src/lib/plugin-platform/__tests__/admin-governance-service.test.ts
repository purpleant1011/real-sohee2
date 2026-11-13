import { describe, it, expect, beforeEach } from 'vitest'
import {
  AdminPluginGovernanceService,
  type PluginGovernanceKpi,
} from '../governance/admin-governance-service'
import type { SoheePluginManifest, WorkspaceInstalledPlugin } from '@/types/plugin-platform'

describe('Admin Plugin Governance Service (ANI-843, ANI-844, ANI-845, ANI-846)', () => {
  let service: AdminPluginGovernanceService

  const sampleCatalog: SoheePluginManifest[] = [
    {
      pluginId: 'plg_insta',
      slug: 'insta',
      displayName: '인스타그램 플러그인',
      version: '1.0.0',
      publisherId: 'pub_sohee',
      publisherType: 'SOHEE',
      summary: '인스타그램 연동',
      categories: ['SNS'],
      outcomeTags: [],
      icon: 'Insta',
      trustTier: 'SOHEE_CORE',
      minPlanTier: 'FREE_TASTE',
      entitlementKey: 'ent_insta',
      capabilities: [],
      requiredScopes: [],
      approvalDefault: 'ALWAYS_ASK',
      creditMeteringPolicyId: 'meter_std',
    },
    {
      pluginId: 'plg_naver',
      slug: 'naver',
      displayName: '네이버 블로그 플러그인',
      version: '1.0.0',
      publisherId: 'pub_sohee',
      publisherType: 'SOHEE',
      summary: '네이버 블로그 연동',
      categories: ['Blog'],
      outcomeTags: [],
      icon: 'Blog',
      trustTier: 'SOHEE_CORE',
      minPlanTier: 'FREE_TASTE',
      entitlementKey: 'ent_naver',
      capabilities: [],
      requiredScopes: [],
      approvalDefault: 'ALWAYS_ASK',
      creditMeteringPolicyId: 'meter_std',
    },
  ]

  const sampleInstallations: WorkspaceInstalledPlugin[] = [
    {
      installationId: 'inst-1',
      workspaceId: 'ws-alpha',
      pluginId: 'plg_insta',
      manifestVersion: '1.0.0',
      state: 'READY',
      installedAt: '2026-09-01T00:00:00Z',
      connectedAccountId: 'acc_1',
      healthStatus: 'HEALTHY',
      lastHealthCheckedAt: '2026-09-06T00:00:00Z',
      approvalMode: 'ALWAYS_ASK',
      isCircuitBreakerOpen: false,
    },
    {
      installationId: 'inst-2',
      workspaceId: 'ws-beta',
      pluginId: 'plg_insta',
      manifestVersion: '1.0.0',
      state: 'DEGRADED',
      installedAt: '2026-09-01T00:00:00Z',
      connectedAccountId: 'acc_2',
      healthStatus: 'DEGRADED',
      lastHealthCheckedAt: '2026-09-06T00:00:00Z',
      approvalMode: 'ALWAYS_ASK',
      isCircuitBreakerOpen: true,
    },
    {
      installationId: 'inst-3',
      workspaceId: 'ws-gamma',
      pluginId: 'plg_naver',
      manifestVersion: '1.0.0',
      state: 'AUTH_REQUIRED',
      installedAt: '2026-09-01T00:00:00Z',
      healthStatus: 'HEALTHY',
      lastHealthCheckedAt: '2026-09-06T00:00:00Z',
      approvalMode: 'ALWAYS_ASK',
      isCircuitBreakerOpen: false,
    },
  ]

  beforeEach(() => {
    service = new AdminPluginGovernanceService()
  })

  it('computes 6-dimension governance KPI accurately (ANI-843)', () => {
    const kpi: PluginGovernanceKpi = service.computeGovernanceKpi(sampleCatalog, sampleInstallations)

    expect(kpi.publishedCount).toBe(2)
    expect(kpi.installedCount).toBe(3)
    expect(kpi.connectedCount).toBe(2)
    expect(kpi.readyCount).toBe(1)
    expect(kpi.degradedCount).toBe(1)
    expect(kpi.blockedCount).toBe(0)
  })

  it('computes tenant occupancy with distinct workspace count (ANI-844)', () => {
    const metric = service.computeTenantOccupancy(sampleCatalog[0], sampleInstallations, 10)

    expect(metric.distinctWorkspaceCount).toBe(2) // ws-alpha and ws-beta
    expect(metric.totalEligibleWorkspaces).toBe(10)
    expect(metric.occupancyRatePercent).toBe(20)
    expect(metric.formulaExplanation).toContain('2개 / 전체 적격 워크스페이스 10개')
  })

  it('verifies SHA-256 artifact digest provenance from actual bytes (ANI-845)', () => {
    const rawContent = JSON.stringify(sampleCatalog[0])
    const res = service.verifyArtifactDigest(sampleCatalog[0], rawContent)

    expect(res.isVerified).toBe(true)
    expect(res.manifestDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(res.provenance).toBe('VERIFIED_SIGNATURE_CHAIN')

    // Empty content must fail verification
    const emptyRes = service.verifyArtifactDigest(sampleCatalog[0], '')
    expect(emptyRes.isVerified).toBe(false)
    expect(emptyRes.provenance).toBe('PLACEHOLDER_OR_CORRUPT')
  })

  it('simulates kill switch impact preview and executes with audit readback (ANI-846)', () => {
    const preview = service.previewKillSwitchImpact('plg_insta', sampleInstallations, [
      { runId: 'run-101', pluginId: 'plg_insta', workspaceId: 'ws-alpha' },
    ])

    expect(preview.impactedWorkspaceCount).toBe(1) // ws-alpha is READY
    expect(preview.activeRunsToAbort).toBe(1)
    expect(preview.riskTier).toBe('CRITICAL')

    const execResult = service.executeKillSwitch('plg_insta', '보안 취약점 긴급 격리', 'admin_super_1', 1)
    expect(execResult.isBlocked).toBe(true)
    expect(execResult.reconciledRunsCount).toBe(1)
    expect(service.isPluginKilled('plg_insta')).toBe(true)
    expect(service.getAuditLog()).toHaveLength(1)
  })
})
