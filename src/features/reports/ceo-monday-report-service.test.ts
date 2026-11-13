import { describe, expect, it } from 'vitest'
import { CeoMondayReportService } from './ceo-monday-report-service'

describe('legacy CEO report truth', () => {
  it.each([
    [undefined, undefined],
    [4, 10],
  ])('does not infer money, reach or saved hours from unverified counts %j', (bookings, posts) => {
    const report = CeoMondayReportService.computeWeeklyImpact(bookings, posts)
    expect(report.generatedRevenueKrw).toBeNull()
    expect(report.laborCostSavedKrw).toBeNull()
    expect(report.netValueContributionKrw).toBeNull()
    expect(report.hoursSaved).toBeNull()
    expect(report.totalReach).toBeNull()
    expect(report.summarySentence).not.toMatch(/450,000|85000|벌어다/)
  })
})
