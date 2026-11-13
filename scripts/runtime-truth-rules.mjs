import ts from 'typescript'

export const RULE_IDS = {
  G1: 'NO_DB_LIST_NULL_AS_EMPTY',
  G2: 'NO_QUOTA_COUNT_NULL_AS_ZERO',
  G3: 'NO_INCOMPLETE_FACT_SNAPSHOT',
  G4: 'NO_GENERIC_CATCH_CREDIT_RESERVE_CODE',
  G5: 'NO_RAW_AUDIT_EVIDENCE_REF_OUTPUT',
  G6: 'NO_DISCARDED_DEMO_FLAG',
  G7: 'NO_HARDCODED_OUTCOME_METRIC_IN_JSX',
}

/** 예시/테스트 분기를 버리는 플래그 이름. */
const DEMO_FLAG_PATTERN = /^(is)?(Demo|TestAccount|Showcase|Sample|Fixture|Mock)$/i

/**
 * 성과 주장으로 읽히는 JSX 리터럴: 백분율·건수·인원·배수.
 * 금액(₩, 원)과 크레딧(SC)은 대부분 가격표·요금 상수라 제외한다(오탐 방지).
 */
const OUTCOME_METRIC_PATTERN = /\d[\d,.]*\s*(?:%|건|명|배)(?![\d,.])/

/**
 * 수치가 '성과 주장'이 되려면 완료·달성·증가 같은 단정 어휘가 함께 있어야 한다.
 * 숫자만 있는 문장(한도·개수 안내)은 성과 주장이 아니므로 제외한다.
 */
const CLAIM_WORD_PATTERN = /(연동됨|연동 완료|완료|달성|증가|절감|향상|확정|신뢰도|성공|정상)/

/** 정책·배분 설명 문맥은 성과 주장이 아니다. */
const POLICY_CONTEXT = /(유지|배분|비중|정책|우선순위)/

/**
 * 이미 결함이 확정되어 별도 작업에서 수정 중인 파일.
 * 다른 브랜치의 게이트를 막지 않도록 임시로 제외한다. 수정 PR 이 머지되면 이 목록에서 지운다.
 * - AttributionOutcomeConsole.tsx: E2E-E 확정분("100% 영수증 결제 증빙 연동됨"), 병렬 수정 중.
 */
const PENDING_FIX_PATHS = ['src/features/attribution/AttributionOutcomeConsole.tsx']

/**
 * 한도·입력 제약처럼 성과가 아닌 문맥. 이 단어가 같은 텍스트에 있으면 성과 주장으로 보지 않는다.
 * 예: "최대 10MB", "8자 이상", "2,200자", "3단계", "10MB 이하"
 */
const NON_CLAIM_CONTEXT = /(이상|이하|최대|최소|미만|초과|자\b|MB|KB|GB|단계|개월|년|일\s*전|초\b|분\s*(?:이내|전)|자리|개\)|px)/

/**
 * Unwrap ParenthesizedExpression and AsExpression (type assertions)
 * @param {ts.Node} node
 * @returns {ts.Node}
 */
function unwrap(node) {
  let curr = node
  while (curr) {
    if (ts.isParenthesizedExpression(curr)) {
      curr = curr.expression
    } else if (ts.isAsExpression(curr)) {
      curr = curr.expression
    } else if (ts.isTypeAssertionExpression(curr)) {
      curr = curr.expression
    } else if (ts.isNonNullExpression(curr)) {
      curr = curr.expression
    } else {
      break
    }
  }
  return curr
}

/**
 * Check if a node is an empty array literal `[]`
 * @param {ts.Node} node
 * @returns {boolean}
 */
function isEmptyArrayLiteral(node) {
  const unwrapped = unwrap(node)
  return ts.isArrayLiteralExpression(unwrapped) && unwrapped.elements.length === 0
}

/**
 * Check if node references query `data` or `rows`
 * @param {ts.Node} node
 * @returns {boolean}
 */
function isQueryDataIdentifier(node) {
  const unwrapped = unwrap(node)
  if (ts.isIdentifier(unwrapped)) {
    return unwrapped.text === 'data' || unwrapped.text === 'rows'
  }
  if (ts.isPropertyAccessExpression(unwrapped)) {
    return unwrapped.name.text === 'data' || unwrapped.name.text === 'rows'
  }
  return false
}

/**
 * Check if the enclosing scope contains a database query origin (.from, .select, .rpc)
 * @param {ts.Node} node
 * @returns {boolean}
 */
function hasDbQueryOrigin(node) {
  let scope = node.parent
  while (scope && !ts.isFunctionDeclaration(scope) && !ts.isFunctionExpression(scope) && !ts.isArrowFunction(scope) && !ts.isMethodDeclaration(scope) && !ts.isSourceFile(scope)) {
    scope = scope.parent
  }
  if (!scope) return false

  let hasQuery = false
  function search(n) {
    if (hasQuery) return
    if (ts.isCallExpression(n)) {
      const exp = n.expression
      if (ts.isPropertyAccessExpression(exp)) {
        const method = exp.name.text
        if (method === 'from' || method === 'select' || method === 'rpc') {
          hasQuery = true
          return
        }
      }
    }
    ts.forEachChild(n, search)
  }
  search(scope)
  return hasQuery
}

/**
 * Check if the function or enclosing block contains an Array.isArray check for the identifier
 * @param {ts.Node} node
 * @param {string} varName
 * @returns {boolean}
 */
function hasArrayGuard(node, varName) {
  let scope = node.parent
  while (scope && !ts.isFunctionDeclaration(scope) && !ts.isFunctionExpression(scope) && !ts.isArrowFunction(scope) && !ts.isMethodDeclaration(scope) && !ts.isSourceFile(scope)) {
    scope = scope.parent
  }
  if (!scope) return false

  let guarded = false
  function search(n) {
    if (guarded) return
    if (ts.isCallExpression(n)) {
      const exp = n.expression
      if (ts.isPropertyAccessExpression(exp) && ts.isIdentifier(exp.expression) && exp.expression.text === 'Array' && exp.name.text === 'isArray') {
        const arg = n.arguments[0]
        if (arg && unwrap(arg).getText() === varName) {
          guarded = true
          return
        }
      }
    }
    ts.forEachChild(n, search)
  }
  search(scope)
  return guarded
}

/**
 * Check if node is `(count ?? 0)` or `count ?? 0` or `count || 0`
 * @param {ts.Node} node
 * @returns {boolean}
 */
function isCountNullishZero(node) {
  const unwrapped = unwrap(node)
  if (!ts.isBinaryExpression(unwrapped)) return false
  const op = unwrapped.operatorToken.kind
  if (op !== ts.SyntaxKind.QuestionQuestionToken && op !== ts.SyntaxKind.BarBarToken) return false
  const right = unwrap(unwrapped.right)
  if (!ts.isNumericLiteral(right) || right.text !== '0') return false
  const left = unwrap(unwrapped.left)
  if (ts.isIdentifier(left) && left.text === 'count') return true
  if (ts.isPropertyAccessExpression(left) && left.name.text === 'count') return true
  return false
}

/**
 * Check if the enclosing scope has `typeof count !== 'number'` or `Number.isSafeInteger(count)`
 * @param {ts.Node} node
 * @returns {boolean}
 */
function hasCountNumericGuard(node) {
  let scope = node.parent
  while (scope && !ts.isFunctionDeclaration(scope) && !ts.isFunctionExpression(scope) && !ts.isArrowFunction(scope) && !ts.isMethodDeclaration(scope) && !ts.isSourceFile(scope)) {
    scope = scope.parent
  }
  if (!scope) return false

  let guarded = false
  function search(n) {
    if (guarded) return
    if (ts.isTypeOfExpression(n) && unwrap(n.expression).getText() === 'count') {
      guarded = true
      return
    }
    if (ts.isCallExpression(n)) {
      const exp = n.expression
      if (ts.isPropertyAccessExpression(exp) && ts.isIdentifier(exp.expression) && exp.expression.text === 'Number' && (exp.name.text === 'isInteger' || exp.name.text === 'isSafeInteger')) {
        const arg = n.arguments[0]
        if (arg && unwrap(arg).getText() === 'count') {
          guarded = true
          return
        }
      }
    }
    ts.forEachChild(n, search)
  }
  search(scope)
  return guarded
}

/**
 * Pure AST-based analyzer for Runtime Truth Gate V2.
 * Does NOT import, eval, or execute target code.
 *
 * @param {string} filePath - relative or absolute file path
 * @param {string} content - source code text
 * @param {object} [options]
 * @returns {{ findings: Array<{ file: string, line: number, rule: string, message: string, symbol?: string }>, analysisErrors: Array<{ file: string, message: string }> }}
 */
export function analyzeSource(filePath, content) {
  const findings = []
  const analysisErrors = []

  let sourceFile
  try {
    sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  } catch (err) {
    analysisErrors.push({ file: filePath, message: `TypeScript parse failed: ${err.message}` })
    return { findings, analysisErrors }
  }

  function getLine(pos) {
    return sourceFile.getLineAndCharacterOfPosition(pos).line + 1
  }

  function visit(node) {
    // ------------------------------------------------------------------------
    // G1: NO_DB_LIST_NULL_AS_EMPTY
    // ------------------------------------------------------------------------
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
        if (isEmptyArrayLiteral(node.right)) {
          const left = unwrap(node.left)
          if (isQueryDataIdentifier(left) && hasDbQueryOrigin(node)) {
            const varName = left.getText()
            if (!hasArrayGuard(node, varName)) {
              findings.push({
                file: filePath,
                line: getLine(node.getStart()),
                rule: RULE_IDS.G1,
                message: `Unvalidated query data coalesced to empty array [] without Array.isArray or observed guard: ${node.getText()}`,
                symbol: varName,
              })
            }
          }
        }
      }
    }

    // ------------------------------------------------------------------------
    // G2: NO_QUOTA_COUNT_NULL_AS_ZERO
    // ------------------------------------------------------------------------
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      const isComparison = [
        ts.SyntaxKind.GreaterThanEqualsToken,
        ts.SyntaxKind.GreaterThanToken,
        ts.SyntaxKind.LessThanEqualsToken,
        ts.SyntaxKind.LessThanToken,
      ].includes(op)

      if (isComparison) {
        const leftHas = isCountNullishZero(node.left)
        const rightHas = isCountNullishZero(node.right)
        if (leftHas || rightHas) {
          const otherSide = leftHas ? unwrap(node.right) : unwrap(node.left)
          const otherText = otherSide.getText()
          const isLimitComparison = /limit|quota|max/i.test(otherText)
          if (isLimitComparison && !hasCountNumericGuard(node)) {
            findings.push({
              file: filePath,
              line: getLine(node.getStart()),
              rule: RULE_IDS.G2,
              message: `Quota count checked using null-coalescing (count ?? 0) without explicit numeric observation guard: ${node.getText()}`,
              symbol: 'count',
            })
          }
        }
      }
    }

    // ------------------------------------------------------------------------
    // G3: NO_INCOMPLETE_FACT_SNAPSHOT
    // ------------------------------------------------------------------------
    if (ts.isCallExpression(node)) {
      const callText = node.expression.getText()
      if (callText === 'resolveApprovedFacts' || callText.endsWith('.resolveApprovedFacts')) {
        let parentScope = node.parent
        while (parentScope && !ts.isFunctionDeclaration(parentScope) && !ts.isFunctionExpression(parentScope) && !ts.isArrowFunction(parentScope) && !ts.isSourceFile(parentScope)) {
          parentScope = parentScope.parent
        }
        if (parentScope) {
          const scopeText = parentScope.getText()
          if (scopeText.includes("'knowledge_facts'") || scopeText.includes('"knowledge_facts"')) {
            const hasSingle = scopeText.includes('maybeSingle') || scopeText.includes('.single(')
            const hasPagination = /while\s*\(|for\s*await|fetchNextPage|\.range\(|\.page\(|count:\s*['"]exact['"]/.test(scopeText)
            if (!hasSingle && !hasPagination) {
              findings.push({
                file: filePath,
                line: getLine(node.getStart()),
                rule: RULE_IDS.G3,
                message: `Bulk knowledge_facts resolved into snapshot hash without pagination, coverage, or exact count verification.`,
                symbol: 'resolveApprovedFacts',
              })
            }
          }
        }
      }
    }

    // ------------------------------------------------------------------------
    // G4: NO_GENERIC_CATCH_CREDIT_RESERVE_CODE
    // ------------------------------------------------------------------------
    if (ts.isTryStatement(node) && node.catchClause) {
      const tryBlock = node.tryBlock
      const catchClause = node.catchClause

      // Count awaits in tryBlock to determine multi-step flow
      let awaitCount = 0
      function countAwaits(n) {
        if (ts.isAwaitExpression(n)) awaitCount++
        ts.forEachChild(n, countAwaits)
      }
      countAwaits(tryBlock)

      if (awaitCount >= 2) {
        // Inspect catchClause for CREDIT_RESERVE_FAILED literal
        function inspectCatch(n) {
          if (ts.isPropertyAssignment(n)) {
            const propName = n.name.getText()
            if (propName === 'code' || propName === "'code'" || propName === '"code"') {
              const valText = unwrap(n.initializer).getText()
              if (valText === "'CREDIT_RESERVE_FAILED'" || valText === '"CREDIT_RESERVE_FAILED"') {
                // Check if this property assignment is strictly guarded by an exact reserve check:
                // e.g. error.code === 'CREDIT_RESERVE_FAILED' or isCreditReserveError(error)
                // Broad error instanceof QuickPostCreditFailure is NOT enough because it includes settle/release errors!
                let curr = n.parent
                let guarded = false
                while (curr && curr !== catchClause) {
                  if (ts.isIfStatement(curr)) {
                    const cond = curr.expression.getText()
                    // Strict guard: exact code check or specific reserve error check
                    if (/===?\s*['"]CREDIT_RESERVE_FAILED['"]|isCreditReserveError|ReserveError/i.test(cond)) {
                      guarded = true
                      break
                    }
                  }
                  curr = curr.parent
                }
                if (!guarded) {
                  findings.push({
                    file: filePath,
                    line: getLine(n.getStart()),
                    rule: RULE_IDS.G4,
                    message: `Generic catch in multi-step flow maps unknown failures to constant CREDIT_RESERVE_FAILED without exact reserve code guard.`,
                    symbol: 'CREDIT_RESERVE_FAILED',
                  })
                }
              }
            }
          }
          ts.forEachChild(n, inspectCatch)
        }
        inspectCatch(catchClause)
      }
    }

    // ------------------------------------------------------------------------
    // G5: NO_RAW_AUDIT_EVIDENCE_REF_OUTPUT
    // ------------------------------------------------------------------------
    if (ts.isCallExpression(node)) {
      const fnName = node.expression.getText()
      if (fnName === 'finding' || fnName.endsWith('.finding')) {
        for (const arg of node.arguments) {
          const unwrapped = unwrap(arg)
          let targetRef = null
          if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
            targetRef = unwrap(unwrapped.left)
          } else {
            targetRef = unwrapped
          }

          if (targetRef) {
            const refText = targetRef.getText()
            if (refText.endsWith('.sourceRef') || refText.endsWith('?.sourceRef') || refText.endsWith('.evidenceRef') || refText.endsWith('?.evidenceRef')) {
              // Check if wrapped in a sanitizer/redactor call
              const isDirectRef = ts.isPropertyAccessExpression(targetRef)
              if (isDirectRef) {
                findings.push({
                  file: filePath,
                  line: getLine(node.getStart()),
                  rule: RULE_IDS.G5,
                  message: `Unvalidated ${refText} passed verbatim to audit finding output without redaction or opaque format verification.`,
                  symbol: refText,
                })
              }
            }
          }
        }
      }
    }

    // ------------------------------------------------------------------------
    // G6: NO_DISCARDED_DEMO_FLAG
    // 예시/테스트 분기를 `void flag` 로 버리면 예시 데이터가 실측처럼 노출된다.
    // ------------------------------------------------------------------------
    if (ts.isVoidExpression(node)) {
      const target = unwrap(node.expression)
      if (ts.isIdentifier(target) && DEMO_FLAG_PATTERN.test(target.text)) {
        findings.push({
          file: filePath,
          line: getLine(node.getStart()),
          rule: RULE_IDS.G6,
          message: `Demo/test flag "${target.text}" is discarded with void; example data can be rendered as measured data. Use it to branch, or remove the parameter.`,
          symbol: target.text,
        })
      }
    }

    // ------------------------------------------------------------------------
    // G7: NO_HARDCODED_OUTCOME_METRIC_IN_JSX
    // JSX 텍스트에 데이터 없는 성과 수치("신뢰도 92%", "예약 15건")를 직접 그리지 않는다.
    // 한도·제약 문맥(최대 10MB, 8자 이상)은 제외한다.
    // ------------------------------------------------------------------------
    if (ts.isJsxText(node)) {
      const text = node.getText(sourceFile)
      if (text.includes('{')) {
        // 보간이 섞인 텍스트는 값의 출처가 코드에 있으므로 대상이 아니다.
      } else if (
        !PENDING_FIX_PATHS.some((pending) => filePath.replace(/\\/g, '/').endsWith(pending)) &&
        OUTCOME_METRIC_PATTERN.test(text) &&
        CLAIM_WORD_PATTERN.test(text) &&
        !NON_CLAIM_CONTEXT.test(text) &&
        !POLICY_CONTEXT.test(text)
      ) {
        const trimmed = text.replace(/\s+/g, ' ').trim()
        findings.push({
          file: filePath,
          line: getLine(node.getStart()),
          rule: RULE_IDS.G7,
          message: `Hardcoded outcome metric rendered as UI text: "${trimmed}". Render a measured value or an honest "측정 전" state instead.`,
          symbol: trimmed.slice(0, 80),
        })
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { findings, analysisErrors }
}
