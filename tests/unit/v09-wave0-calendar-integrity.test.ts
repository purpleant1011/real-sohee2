import { describe, it, expect } from 'vitest'
import { buildMonthGrid } from '@/components/v088/calendar/marketing-calendar'
import fs from 'fs'
import path from 'path'

describe('ANI-917: Calendar Integrity & Legacy Energy Copy Elimination', () => {
  it('generates strictly valid calendar days for 2026-09 (no 31st, 32nd, 33rd, 34th of September)', () => {
    const cells = buildMonthGrid(2026, 9)

    expect(cells.length).toBe(35)

    // Verify each cell
    for (const cell of cells) {
      const parts = cell.dateStr.split('-').map(Number)
      const year = parts[0]
      const month = parts[1]
      const day = parts[2]

      expect(cell.dayNum).toBe(day)

      // Verify date is valid
      const parsed = new Date(Date.UTC(year, month - 1, day))
      expect(parsed.getUTCFullYear()).toBe(year)
      expect(parsed.getUTCMonth() + 1).toBe(month)
      expect(parsed.getUTCDate()).toBe(day)

      // September only has 30 days
      if (month === 9) {
        expect(day).toBeLessThanOrEqual(30)
      }

      // No day number should ever exceed 31
      expect(cell.dayNum).toBeLessThanOrEqual(31)
    }

    // Oct 1st to 4th should be next month padding
    const octCell1 = cells.find(c => c.dateStr === '2026-10-01')
    expect(octCell1).toBeDefined()
    expect(octCell1?.dayNum).toBe(1)
    expect(octCell1?.isCurrentMonth).toBe(false)
  })

  it('handles leap years correctly for February (e.g. 2028 leap vs 2026 non-leap)', () => {
    const feb2026 = buildMonthGrid(2026, 2)
    const feb2026Days = feb2026.filter(c => c.isCurrentMonth)
    expect(feb2026Days.length).toBe(28)

    const feb2028 = buildMonthGrid(2028, 2)
    const feb2028Days = feb2028.filter(c => c.isCurrentMonth)
    expect(feb2028Days.length).toBe(29)
  })

  it('statically ensures zero legacy Energy copy in content-view.tsx', () => {
    const contentViewPath = path.resolve(process.cwd(), 'src/app/app/content/content-view.tsx')
    const content = fs.readFileSync(contentViewPath, 'utf8')

    expect(content).not.toContain('10 Energy')
    expect(content).not.toContain('Energy / 24h')
  })
})
