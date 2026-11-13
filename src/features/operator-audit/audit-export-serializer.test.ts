import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { serializeAuditExportCsv, sha256Csv } from './audit-export-serializer'

describe('audit export serializer', () => {
  it('keeps only the safe whitelist and escapes CSV cells', async () => {
    const csv = serializeAuditExportCsv([{ createdAt: '2026-08-23T00:00:00.000Z', workspaceName: '고객사', action: 'credit.adjust.applied', targetType: 'credit_account', result: 'succeeded', factKind: 'observed', reason: '사유, 확인', approvalStatus: 'approved', before: { amount: 1, token: 'secret' }, after: { amount: 2, provider_reference: 'raw' }, idempotency_key: 'never', provider_reference: 'never' }])
    expect(csv).toContain('시간,고객사,작업,대상,결과,사실 구분,사유,승인 상태')
    expect(csv).toContain('"사유, 확인"')
    expect(csv).not.toContain('secret')
    expect(csv).not.toContain('provider_reference')
    expect(csv).not.toContain('idempotency_key')
    await expect(sha256Csv(csv)).resolves.toMatch(/^[a-f0-9]{64}$/u)
  })
  it('neutralizes spreadsheet formula prefixes', () => {
    const csv = serializeAuditExportCsv([{ createdAt: '2026-08-23T00:00:00.000Z', workspaceName: '=cmd', action: '+SUM(1,1)', targetType: '-x', result: '@x', factKind: 'observed', reason: 'ok', approvalStatus: 'none' }])
    expect(csv).toContain("'=cmd")
    expect(csv).toContain("'+SUM(1,1)")
    expect(csv).toContain("'-x")
    expect(csv).toContain("'@x")
  })
})
