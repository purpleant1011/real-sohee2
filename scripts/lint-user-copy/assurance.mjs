import ts from 'typescript'
import { loadWarnRules } from './matcher.mjs'

/**
 * 하드코딩된 정상 확인 문구 탐지 (ANI-1553 v2, 경고 전용)
 *
 * 배경: 에이전트가 해시/계정 비교 자리에 "승인한 내용과 같아요"를 조건 없이 박아 넣어
 * 실제로는 달라졌는데도 정상처럼 보이게 한 사례. 영문 상태어 lint 로는 잡을 수 없는 "거짓 정상 표시"다.
 *
 * 탐지: 정상/일치/확인 단정 문구가 JSX 텍스트(또는 단독 문자열 표현식)로 렌더되는데,
 *       그 JSX가 삼항·&&·||·??·if·switch 어디에도 묶여 있지 않으면 경고한다.
 *
 * 한계 (그래서 경고 수준):
 *  - 함수 밖에서 이미 계산된 조건으로 컴포넌트 자체를 걸러 렌더하는 경우를 알 수 없다 (오탐)
 *  - 범례·도움말·고정 라벨(예: "확인됨" 뜻 설명)도 같은 문구라 구분이 어렵다 (오탐)
 *  - view-model(.ts)이 문구를 박아 내려주는 경우는 보지 못한다 (미탐)
 *  동적 층(scan-rendered)과 단위 테스트가 함께 있어야 의미가 있다.
 */

function enclosingJsxElementName(node) {
  let cur = node.parent
  while (cur) {
    if (ts.isJsxElement(cur)) return cur.openingElement.tagName.getText()
    if (ts.isJsxSelfClosingElement(cur)) return cur.tagName.getText()
    cur = cur.parent
  }
  return null
}

/** JSX가 조건(삼항/논리/if/switch)에 묶여 있는지 (함수 경계까지만 탐색) */
function isConditionallyRendered(node) {
  let child = node
  let cur = node.parent
  while (cur) {
    if (
      ts.isArrowFunction(cur) ||
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isMethodDeclaration(cur)
    ) {
      // .map(item => <li/>) 같은 인라인 콜백은 바깥 조건({cond && list.map(...)})까지 계속 올라간다
      const callParent = cur.parent
      if (callParent && ts.isCallExpression(callParent) && callParent.arguments.includes(cur)) {
        child = cur
        cur = callParent
        continue
      }
      return false
    }
    if (ts.isConditionalExpression(cur) && child !== cur.condition) return true
    if (
      ts.isBinaryExpression(cur) &&
      child === cur.right &&
      (cur.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        cur.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        cur.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      return true
    }
    if (ts.isIfStatement(cur) && child !== cur.expression) return true
    if (ts.isCaseClause(cur) || ts.isDefaultClause(cur)) return true
    child = cur
    cur = cur.parent
  }
  return false
}

/**
 * @param {string} filePath
 * @param {string} content
 * @param {Array} [warnRules]
 * @returns {Array<{ file: string, line: number, column: number, ruleId: string, ruleName: string, severity: 'warn', matched: string, context: string, snippet: string }>}
 */
export function scanAssuranceWarnings(filePath, content, warnRules = loadWarnRules()) {
  const rules = warnRules.filter(r => r.id === 'WARN_HARDCODED_ASSURANCE')
  if (rules.length === 0) return []

  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  if (!filePath.endsWith('.tsx')) return []

  const warnings = []

  function check(node, text, start, contextDesc) {
    const trimmed = text.replace(/\s+/g, ' ').trim()
    if (!trimmed) return
    for (const rule of rules) {
      if (trimmed.length > (rule.maxLength ?? 60)) continue
      const assurance = new RegExp(rule.assurancePattern).exec(trimmed)
      if (!assurance) continue
      if (rule.hedgePattern && new RegExp(rule.hedgePattern).test(trimmed)) continue
      const tag = enclosingJsxElementName(node)
      if (tag && (rule.skipElements || []).includes(tag)) continue
      if (isConditionallyRendered(node)) continue

      const { line, character } = sourceFile.getLineAndCharacterOfPosition(start)
      warnings.push({
        file: filePath,
        line: line + 1,
        column: character + 1,
        ruleId: rule.id,
        ruleName: rule.name,
        severity: 'warn',
        matched: assurance[0],
        context: contextDesc,
        snippet: trimmed.slice(0, 100),
      })
    }
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      if (node.text.trim().length > 0) check(node, node.text, node.pos + (node.text.length - node.text.trimStart().length), 'JSXText')
    } else if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) && node.expression) {
      // {'정상이에요'} 처럼 단독 문자열 표현식 (삼항/논리식은 조건부이므로 제외)
      const expr = node.expression
      if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
        check(node, expr.text, expr.getStart(sourceFile) + 1, 'JsxExpression')
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return warnings
}
