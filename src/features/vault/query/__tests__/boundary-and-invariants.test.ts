import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ANI-1531: Import Boundary & Invariant Static Analysis', () => {
  const queryDirPath = path.resolve(__dirname, '..')
  const routesDirPath = path.resolve(
    __dirname,
    '../../../../app/api/workspaces/[workspaceId]/vault',
  )

  const forbiddenPatterns = [
    /from\s+['"].*publishing.*['"]/,
    /from\s+['"].*provider.*['"]/,
    /from\s+['"].*oauth.*['"]/,
    /from\s+['"]axios['"]/,
    /from\s+['"]node-fetch['"]/,
  ]

  it('src/features/vault/query/**/*.ts 는 publishing, provider, oauth 등을 절대 import하지 않는다', () => {
    const files = fs
      .readdirSync(queryDirPath)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

    for (const file of files) {
      const content = fs.readFileSync(path.join(queryDirPath, file), 'utf8')
      for (const pattern of forbiddenPatterns) {
        expect(
          pattern.test(content),
          `Forbidden import pattern "${pattern}" detected in ${file}`,
        ).toBe(false)
      }
    }
  })

  it('vault API routes (/items, /calendar, /summary) 는 publishing, provider, oauth 등을 절대 import하지 않는다', () => {
    const routeDirs = ['items', 'calendar', 'summary']
    for (const dir of routeDirs) {
      const filePath = path.join(routesDirPath, dir, 'route.ts')
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8')
        for (const pattern of forbiddenPatterns) {
          expect(
            pattern.test(content),
            `Forbidden import pattern "${pattern}" detected in route ${dir}/route.ts`,
          ).toBe(false)
        }
      }
    }
  })

  it('사용자 노출 라벨에서 "예약됨" 문구가 일절 정의되지 않는다', () => {
    const formattersContent = fs.readFileSync(path.join(queryDirPath, 'formatters.ts'), 'utf8')
    expect(formattersContent).not.toContain('예약됨')
  })
})
