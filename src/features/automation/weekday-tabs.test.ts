import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('자동화 요일 탭', () => {
  it('요일 라벨이 줄바꿈되지 않고 가로로 밀어 볼 수 있다', () => {
    const src = readFileSync('src/features/automation/automation-workspace.tsx', 'utf8')
    const tabs = src.match(/className=\{`[^`]*rounded-lg text-sm font-bold[^`]*`\}\n\s*>\n\s*[월화수목금토일]요일/g) ?? []
    expect(tabs.length).toBe(7)
    for (const t of tabs) expect(t).toMatch(/whitespace-nowrap/)
  })
})
