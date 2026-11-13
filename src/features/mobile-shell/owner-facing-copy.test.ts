import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

/**
 * 사장님 노출 금지어 목록 (S2-W4)
 * 기술 내부 코드나 엔지니어링 용어가 사장님 화면에 노출되지 않도록 회귀를 차단한다.
 */
export const FORBIDDEN_OWNER_TERMS = [
  '킬스위치',
  '웹훅',
  'Graph API',
  'IMMUTABLE',
  'CN-0',
  'PG 연결 전',
  '(UTC)',
  '영수증 ID',
  'ZIP 다운로드',
] as const

/**
 * 소유 범위 밖 파일에서 불가피하게 남아 있는 위반 항목에 대한 허용 목록(ALLOW).
 * 소유 범위 밖 파일 위반은 임의 수정하지 않고 파일:사유 형태로 기록한다.
 */
export const FORBIDDEN_COPY_ALLOWLIST: Record<string, string> = {
  // 예시: 'src/app/app/legacy-route.tsx': '소유 범위 밖 레거시 화면, 후속 스프린트 정리 예정'
}

function collectTsxFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const results: string[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '__tests__') {
        results.push(...collectTsxFiles(fullPath))
      }
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.tsx') &&
      !entry.name.includes('.test.') &&
      !entry.name.includes('.spec.')
    ) {
      results.push(fullPath)
    }
  }
  return results
}

function findForbiddenViolationsInFile(filePath: string): Array<{ term: string; line: number; text: string }> {
  const code = fs.readFileSync(filePath, 'utf-8')
  const sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true)
  const violations: Array<{ term: string; line: number; text: string }> = []

  function visit(node: ts.Node) {
    let text: string | null = null
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      text = node.text
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      text = node.text
    } else if (ts.isJsxText(node)) {
      text = node.text
    }

    if (text) {
      for (const term of FORBIDDEN_OWNER_TERMS) {
        if (text.includes(term)) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
          violations.push({ term, line, text: text.trim().slice(0, 100) })
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violations
}

describe('사장님 노출 금지어 회귀 방지 (owner-facing copy)', () => {
  const root = process.cwd()

  const targetDirs: string[] = []
  const featuresDir = path.join(root, 'src/features')
  if (fs.existsSync(featuresDir)) {
    for (const entry of fs.readdirSync(featuresDir)) {
      if (entry.startsWith('mobile-')) {
        targetDirs.push(path.join(featuresDir, entry))
      }
    }
  }
  targetDirs.push(path.join(root, 'src/app/app'))

  const allFiles = targetDirs.flatMap(collectTsxFiles)

  it('검사 대상 파일이 10개 이상 발견된다', () => {
    expect(allFiles.length).toBeGreaterThanOrEqual(10)
  })

  it('AST 파서가 JSX 텍스트 및 문자열 리터럴의 금지어를 정확히 감지한다', () => {
    const testSnippet = `
      export function Dummy() {
        return (
          <div>
            <span>킬스위치 가동</span>
            <p>{'Graph API 호출'}</p>
          </div>
        )
      }
    `
    const sf = ts.createSourceFile('dummy.tsx', testSnippet, ts.ScriptTarget.Latest, true)
    const detected: string[] = []
    function visit(node: ts.Node) {
      let text: string | null = null
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        text = node.text
      } else if (ts.isJsxText(node)) {
        text = node.text
      }
      if (text) {
        for (const term of FORBIDDEN_OWNER_TERMS) {
          if (text.includes(term)) detected.push(term)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    expect(detected).toContain('킬스위치')
    expect(detected).toContain('Graph API')
  })

  it('src/features/mobile-*/** 및 src/app/app/** 소스에 금지어가 포함되지 않아야 한다', () => {
    const unallowedViolations: Array<{ file: string; line: number; term: string; text: string }> = []

    for (const filePath of allFiles) {
      const relPath = path.relative(root, filePath)
      if (FORBIDDEN_COPY_ALLOWLIST[relPath]) {
        continue
      }

      const fileViolations = findForbiddenViolationsInFile(filePath)
      for (const v of fileViolations) {
        unallowedViolations.push({ file: relPath, ...v })
      }
    }

    expect(
      unallowedViolations,
      `금지어 위반 발견:\n${unallowedViolations.map(u => ` - ${u.file}:${u.line} [${u.term}] "${u.text}"`).join('\n')}`,
    ).toEqual([])
  })
})
