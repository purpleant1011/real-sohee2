import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// 정적 import가 다시 들어오면 모바일도 PC 트리의 다운로드·평가를 기다리게 된다.
describe('홈 진입점 코드 분리', () => {
  it('모바일 분기에는 PC 홈과 R1의 정적 의존이 없다', () => {
    const source = readFileSync('src/components/home-today/today-home.tsx', 'utf8')
    const file = ts.createSourceFile('today-home.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const imports = file.statements.filter(ts.isImportDeclaration).map(node => (node.moduleSpecifier as ts.StringLiteral).text)
    expect(imports).not.toContain('@/components/v088/layout/v088-app-shell')
    expect(imports).not.toContain('@/hooks/use-sohee-autonomy')
    expect(imports).not.toContain('@/features/mobile-decision/mobile-today')
    expect(imports).not.toContain('./legacy-today-home')
    expect(source).toContain("import('./legacy-today-home')")
  })
})
