import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), 'src', path), 'utf8')

describe('reporting consumer truth boundaries', () => {
  it('uses the same weekly server DTO on home instead of parallel outcome calculators', () => {
    const homeView = source('components/home-today/legacy-today-home.tsx')
    const sectionsView = source('components/home-today/legacy-home-sections.tsx')
    expect(homeView).toContain('LegacyHomeSections')
    expect(homeView).toContain('includeWeeklyTruthSummary')
    expect(sectionsView).toContain('<WeeklyTruthSummary workspaceId={workspaceId}')
    expect(homeView).not.toContain('<HomeDashboardMetricsCards')
    expect(homeView).not.toContain('<HomeMetricsWidget')
    expect(homeView).not.toContain('<HomeVerifiedResultsSection')
    expect(sectionsView).not.toContain('<HomeDashboardMetricsCards')
    expect(sectionsView).not.toContain('<HomeMetricsWidget')
    expect(sectionsView).not.toContain('<HomeVerifiedResultsSection')
  })
  it('uses the same canonical report for results instead of a reservation revenue reducer', () => {
    const view = source('app/app/results/results-view.tsx')
    expect(view).toContain('WeeklyCeoReportData')
    expect(view).toContain('/reports/weekly')
    expect(view).not.toContain('setVerifiedRevenue')
    expect(view).not.toMatch(/hoursSaved=\{42\}|costSavedWon=\{350000\}|80,000/)
  })

  it('never switches actual CRM data into demo mode or fills in paid amounts', () => {
    const view = source('app/app/customers/customers-view.tsx')
    expect(view).not.toContain("setCustomerState('demo')")
    expect(view).not.toMatch(/total_amount_krw\s*\|\|\s*80000|deposit_krw\s*\|\|\s*20000/)
    expect(view).toContain('/customers/pipeline')
  })
})
