import { describe, it, expect } from 'vitest'
import {
  evaluateFreshnessGrade,
  resolveTelemetryPoint,
  resolveInfrastructureNodes,
  type MeasuredTelemetryPoint
} from '@/features/operator-system/telemetry-resolver'
import fs from 'fs'
import path from 'path'

describe('ANI-941: Admin Observability Real Telemetry & False-Green Elimination', () => {
  const now = new Date('2026-09-06T12:00:00.000Z')

  it('marks telemetry as UNKNOWN when measured_at is null or missing', () => {
    const point = resolveTelemetryPoint({
      source: 'TEST_PROBE',
      measured_at: null,
      window: '5m',
      query_id: 'probe-001',
      latency_ms: null,
      uptime_pct: null,
      now,
    })

    expect(point.freshness_grade).toBe('UNKNOWN')
    expect(point.status).toBe('UNKNOWN')
    expect(point.latency_ms).toBeNull()
    expect(point.uptime_pct).toBeNull()
  })

  it('evaluates freshness threshold: FRESH <= 5m, STALE <= 30m, UNKNOWN > 30m', () => {
    // 3 minutes ago -> FRESH
    const freshAt = new Date(now.getTime() - 3 * 60 * 1000).toISOString()
    expect(evaluateFreshnessGrade(freshAt, now)).toBe('FRESH')

    // 15 minutes ago -> STALE
    const staleAt = new Date(now.getTime() - 15 * 60 * 1000).toISOString()
    expect(evaluateFreshnessGrade(staleAt, now)).toBe('STALE')

    // 45 minutes ago -> UNKNOWN
    const expiredAt = new Date(now.getTime() - 45 * 60 * 1000).toISOString()
    expect(evaluateFreshnessGrade(expiredAt, now)).toBe('UNKNOWN')
  })

  it('never outputs fake 99.98% or 18ms when no actual measurements exist', () => {
    const nodes = resolveInfrastructureNodes([], [], now)

    for (const node of nodes) {
      if (node.telemetry.freshness_grade === 'UNKNOWN') {
        expect(node.uptimeLabel).not.toBe('99.98%')
        expect(node.uptimeLabel).not.toBe('99.99%')
        expect(node.latencyLabel).not.toBe('18ms')
        expect(node.latencyLabel).not.toBe('24ms')
        expect(node.statusLabel).toBe('UNKNOWN')
      }
    }
  })

  it('statically ensures no hardcoded false-green 99.98% or legacy V0.3 copy in admin pages', () => {
    const adminSystemPath = path.resolve(process.cwd(), 'src/app/admin/system/page.tsx')
    const adminSupportPath = path.resolve(process.cwd(), 'src/app/admin/support/page.tsx')

    const adminSystemContent = fs.readFileSync(adminSystemPath, 'utf8')
    const adminSupportContent = fs.readFileSync(adminSupportPath, 'utf8')

    // 1. No hardcoded 99.98% in admin system
    expect(adminSystemContent).not.toContain('99.98%')
    expect(adminSystemContent).not.toContain("latency: '18ms'")
    expect(adminSystemContent).not.toContain("latency: '24ms'")
    expect(adminSystemContent).not.toContain("latency: '480ms'")
    expect(adminSystemContent).not.toContain('서비스 상태 확인 전 · 정상 유지')

    // 2. No legacy V0.3 copy
    expect(adminSupportContent).not.toContain('V0.3')
  })
})
