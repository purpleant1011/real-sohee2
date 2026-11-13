import { describe, it, expect } from 'vitest'
import { WeeklyCeoReportService } from '@/features/reporting/weekly-ceo-report-service'

// Reservation amounts alone cannot certify payment or revenue.
describe('Results revenue truth', () => {
  it('keeps revenue and captured deposits unobserved without verified payment evidence', async () => {
    const report = await new WeeklyCeoReportService().generateReport('ws-test')
    expect(report.totalRevenueWon).toBeNull()
    expect(report.metrics.revenue.state).toBe('NOT_OBSERVED')
    expect(report.metrics.paymentCapturedVerified.state).toBe('NOT_OBSERVED')
    expect(report.costSavedWon).toBeNull()
  })
})
