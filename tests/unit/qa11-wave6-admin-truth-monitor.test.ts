import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import {
  evaluateCreativeTruthVerdict,
  type CreativeTruthSnapshot,
  type CreativeTruthVerdictResult,
} from '@/features/admin/admin-truth-snapshot-service'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProductionTruthMonitor } from '@/features/admin/production-truth-monitor'

describe('ANI-1139: Admin Creative Truth Monitor Live Evidence & Anti-False-Green', () => {
  const baseValidSnapshot: CreativeTruthSnapshot = {
    snapshotId: 'truth_snap_1139_valid',
    observedAt: new Date().toISOString(),
    git: {
      sha: '6785ac3',
      branch: 'feat/11th-production-ground-truth',
      isClean: true,
    },
    deployment: {
      target: 'production',
      buildId: 'sohee-v0.9.0-prod',
      liveUrl: 'https://real-sohee.com',
      isLiveReachable: true,
    },
    database: {
      ref: 'db_sohee_prod',
      migrationHead: '20260908120000_11th_truth_closure',
      tableCounts: {
        mediaAssets: 42,
        creativeBundles: 15,
        publishRenditions: 15,
        providerDeliveryLeases: 15,
        externalActionReceipts: 15,
        providerObservedMedia: 15,
      },
      provenance: {
        totalMediaAssets: 42,
        generatedOpenAiCount: 42,
        missingModelMetadataCount: 0,
        missingSha256Count: 0,
        quarantinedCount: 0,
      },
      securityAdvisor: {
        securityDefinerCount: 0,
        rlsNoPolicyCount: 0,
        leakedPasswordCount: 0,
      },
      metaReadiness: {
        mode: 'TEST_ROLE_READY',
        dataDeletionCallbackActive: true,
        disclaimerAgreed: true,
      },
    },
    evidenceId: 'ev_lin_ani_1139',
  }

  it('prohibits exact approval PASS when creative_bundles count is 0 (Acceptance Invariant)', () => {
    const zeroBundleSnapshot: CreativeTruthSnapshot = {
      ...baseValidSnapshot,
      database: {
        ...baseValidSnapshot.database,
        tableCounts: {
          ...baseValidSnapshot.database.tableCounts,
          creativeBundles: 0, // Zero bundles in production
        },
      },
    }

    const result = evaluateCreativeTruthVerdict(zeroBundleSnapshot)

    expect(result.exactApprovalStatus).not.toBe('PASS')
    expect(result.exactApprovalStatus).toBe('NO_BUNDLES_PENDING')
    expect(result.verdict).toBe('RELEASE_BLOCKED')
    expect(result.findings.some(f => f.includes('creative_bundles = 0'))).toBe(true)
  })

  it('matches Admin verdict to RELEASE_BLOCKED when security advisor has warnings or blockers', () => {
    const advisorViolationSnapshot: CreativeTruthSnapshot = {
      ...baseValidSnapshot,
      database: {
        ...baseValidSnapshot.database,
        securityAdvisor: {
          securityDefinerCount: 63, // 63 SECURITY DEFINER debt
          rlsNoPolicyCount: 23,     // 23 missing RLS policies
          leakedPasswordCount: 1,
        },
      },
    }

    const result = evaluateCreativeTruthVerdict(advisorViolationSnapshot)

    expect(result.verdict).toBe('RELEASE_BLOCKED')
    expect(result.securityAdvisorStatus).toBe('BLOCKED')
    expect(result.findings.some(f => f.includes('63 SECURITY DEFINER'))).toBe(true)
    expect(result.findings.some(f => f.includes('23 tables with RLS'))).toBe(true)
  })

  it('blocks release when provenance pollution is detected (missing model metadata or SHA-256)', () => {
    const corruptedProvenanceSnapshot: CreativeTruthSnapshot = {
      ...baseValidSnapshot,
      database: {
        ...baseValidSnapshot.database,
        provenance: {
          ...baseValidSnapshot.database.provenance,
          missingModelMetadataCount: 2,
          missingSha256Count: 1,
        },
      },
    }

    const result = evaluateCreativeTruthVerdict(corruptedProvenanceSnapshot)

    expect(result.verdict).toBe('RELEASE_BLOCKED')
    expect(result.provenanceStatus).toBe('POLLUTED')
    expect(result.findings.some(f => f.includes('missing model metadata'))).toBe(true)
    expect(result.findings.some(f => f.includes('missing SHA256'))).toBe(true)
  })

  it('detects stale snapshot when observedAt exceeds 15 minutes and refuses to report PASS', () => {
    const staleSnapshot: CreativeTruthSnapshot = {
      ...baseValidSnapshot,
      // 20 minutes ago
      observedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    }

    const result = evaluateCreativeTruthVerdict(staleSnapshot)

    expect(result.verdict).toBe('RELEASE_BLOCKED')
    expect(result.freshnessStatus).toBe('STALE')
    expect(result.findings.some(f => f.includes('STALE_EVIDENCE'))).toBe(true)
  })

  it('evaluates completely clean live snapshot as FRESH_ALIGNED', () => {
    const result = evaluateCreativeTruthVerdict(baseValidSnapshot)

    expect(result.verdict).toBe('FRESH_ALIGNED')
    expect(result.isReleaseReady).toBe(true)
    expect(result.exactApprovalStatus).toBe('PASS')
    expect(result.provenanceStatus).toBe('CLEAN')
    expect(result.securityAdvisorStatus).toBe('CLEAN')
    expect(result.findings.length).toBe(0)
  })

  it('renders ProductionTruthMonitor with live evidence without any mocked demo status', () => {
    const html = renderToStaticMarkup(
      React.createElement(ProductionTruthMonitor, { snapshot: baseValidSnapshot })
    )

    // Git SHA, Build ID, Migration head, and evidence ID must be displayed
    expect(html).toContain('6785ac3')
    expect(html).toContain('sohee-v0.9.0-prod')
    expect(html).toContain('20260908120000_11th_truth_closure')
    expect(html).toContain('ev_lin_ani_1139')

    // Live counts
    expect(html).toContain('42') // mediaAssets
    expect(html).toContain('15') // creativeBundles

    // Anti-False-Green: Must not contain mocked strings
    expect(html).not.toContain('바이름')
    expect(html).not.toContain('studio_by.reum')
    expect(html).not.toContain('images.unsplash.com')
  })

  it('renders ProductionTruthMonitor in BLOCKED state with visible findings when creative_bundles = 0', () => {
    const zeroBundleSnapshot: CreativeTruthSnapshot = {
      ...baseValidSnapshot,
      database: {
        ...baseValidSnapshot.database,
        tableCounts: {
          ...baseValidSnapshot.database.tableCounts,
          creativeBundles: 0,
        },
      },
    }

    const html = renderToStaticMarkup(
      React.createElement(ProductionTruthMonitor, { snapshot: zeroBundleSnapshot })
    )

    expect(html).toContain('RELEASE_BLOCKED')
    expect(html).toContain('NO_BUNDLES_PENDING')
    expect(html).toContain('creative_bundles = 0')
  })

  it('blocks release with P0 Git Integrity Breach when working tree is dirty (git.isClean === false)', () => {
    const dirtySnapshot: CreativeTruthSnapshot = {
      ...baseValidSnapshot,
      git: {
        ...baseValidSnapshot.git,
        isClean: false,
      },
    }

    const result = evaluateCreativeTruthVerdict(dirtySnapshot, baseValidSnapshot.observedAt)
    expect(result.verdict).toBe('RELEASE_BLOCKED')
    expect(result.isReleaseReady).toBe(false)
    expect(result.findings.some(f => f.includes('P0 Git Integrity Breach'))).toBe(true)
  })

  it('blocks release with P0 Deployment Failure when deployment is unreachable (isLiveReachable === false)', () => {
    const unreachableSnapshot: CreativeTruthSnapshot = {
      ...baseValidSnapshot,
      deployment: {
        ...baseValidSnapshot.deployment,
        isLiveReachable: false,
      },
    }

    const result = evaluateCreativeTruthVerdict(unreachableSnapshot, baseValidSnapshot.observedAt)
    expect(result.verdict).toBe('RELEASE_BLOCKED')
    expect(result.isReleaseReady).toBe(false)
    expect(result.findings.some(f => f.includes('P0 Deployment Failure'))).toBe(true)
  })
})
