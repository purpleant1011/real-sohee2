import type { WeeklyCeoReportData } from '@/features/reporting/weekly-ceo-report-service'

export interface CeoWeeklyImpact {
  weekLabel: string
  laborCostSavedKrw: number | null
  generatedRevenueKrw: number | null
  netValueContributionKrw: number | null
  hoursSaved: number | null
  confirmedBookingsCount: number | null
  totalReach: number | null
  summarySentence: string
}

export class CeoMondayReportService {
  static fromReport(report: WeeklyCeoReportData): CeoWeeklyImpact {
    return {
      weekLabel: report.periodLabel,
      laborCostSavedKrw: report.costSavedWon,
      generatedRevenueKrw: report.totalRevenueWon,
      netValueContributionKrw: null,
      hoursSaved: report.hoursSaved,
      confirmedBookingsCount: report.confirmedBookingsCount,
      totalReach: null,
      summarySentence: report.executiveSummary,
    }
  }

  /** Legacy counts are not evidence of income, reach or savings. */
  static computeWeeklyImpact(_confirmedBookings?: number, _postsPublished?: number): CeoWeeklyImpact {
    return {
      weekLabel: '조회 기간 확인 필요',
      laborCostSavedKrw: null,
      generatedRevenueKrw: null,
      netValueContributionKrw: null,
      hoursSaved: null,
      confirmedBookingsCount: null,
      totalReach: null,
      summarySentence: '확인된 기록을 연결한 뒤 성과를 보여드려요.',
    }
  }
}
