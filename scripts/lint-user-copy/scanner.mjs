import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { matchText } from './matcher.mjs'
import {
  collectCopyLeaves,
  enclosingFunctionName,
  hasHangul,
  isCodeContext,
  isLlmInstructionContext,
  isValidationIssueCode,
  isLabelMapName,
  isUiJsxAttr,
  isUiName,
  propertyNameText,
} from './ast-context.mjs'
import { scanAssuranceWarnings } from './assurance.mjs'

/** 템플릿 리터럴의 정적 조각을 이어붙일 때 쓰는 구분자 (단어 경계가 되도록 비-단어 문자) */
const PART_SEPARATOR = '\u0000'

/** 호출 인자가 곧 사용자 화면 문구인 함수 (toast('…'), alert('…'), setErrorMessage('…') 등) */
const UI_CALL_NAMES = /^(toast|alert|confirm|notify|showtoast|showmessage|showerror|shownotice)$/i
const UI_CALL_HEADS = new Set(['toast', 'message', 'notification', 'alert', 'notify'])
const UI_SETTER = /^set(error|errormessage|message|notice|toast|feedback|hint|label|text|title|description|warning|helper|statusmessage|statustext|statuslabel)/i

/**
 * 특정 파일이 사용자 화면 검사 대상인지 확인
 *
 * 사용자 화면 범위 (v2: 경로 이름이 아니라 "소스 위치"로 판정한다):
 * - src/app/**        (api, admin, operator, dev 갤러리 제외)
 * - src/components/** (admin/operator 제외)
 * - src/features/**   (admin/operator 제외, .ts 포함 — 홈 요약 문구처럼 .ts 매퍼가 사용자 문구를 만든다)
 *
 * 제외 규칙:
 * - admin, operator 경로 및 파일명 전면 제외
 * - 테스트 파일 (*.test.*, *.spec.*, __tests__, tests/), fixtures, mocks, stories, *.d.ts
 * - api 라우트 (src/app/api, route.ts)
 * - 개발 전용 갤러리 (src/app/dev) — 렌더 결과는 lint:user-copy:rendered 가 검사
 */
export function isUserFacingPath(filePath) {
  const norm = filePath.replace(/\\/g, '/')
  const lower = norm.toLowerCase()

  // 1. admin, operator 전면 제외
  if (
    lower.includes('/admin/') ||
    lower.includes('/operator/') ||
    lower.includes('admin-') ||
    lower.includes('operator-') ||
    lower.includes('/admin.') ||
    lower.includes('/operator.') ||
    lower.includes('-admin.') ||
    lower.includes('-operator.') ||
    lower.endsWith('/admin') ||
    lower.endsWith('/operator') ||
    /(^|\/)admin\//.test(lower) ||
    /(^|\/)operator\//.test(lower) ||
    // 카멜/파스칼 케이스 파일명 (AdminCustomer360Timeline.tsx, operatorConsole.tsx 등)
    /(^|\/)(?:[Aa]dmin|[Oo]perator)(?=[A-Z0-9_.-])/.test(norm)
  ) {
    return false
  }

  // 2. 비프로덕션 및 백엔드/개발 전용 경로 제외
  if (
    /(^|\/)(__tests__|__mocks__|tests?|fixtures?|mocks?|node_modules|\.next|\.worktrees|dist|build)(\/|$)/.test(lower) ||
    /\.(test|spec)\.[jt]sx?$/.test(lower) ||
    /\.stories\.[jt]sx?$/.test(lower) ||
    /\.d\.[cm]?ts$/.test(lower) ||
    /(^|\/)src\/app\/api\//.test(lower) ||
    /(^|\/)route\.[jt]sx?$/.test(lower) ||
    /(^|\/)src\/app\/dev\//.test(lower)
  ) {
    return false
  }

  // 3. 확장자 필터 (.ts, .tsx만)
  if (!/\.(tsx|ts)$/.test(norm)) {
    return false
  }

  // 4. 포함 대상 사용자 화면 경로 확인
  const isIncluded =
    norm.includes('src/app/(onboarding)') ||
    norm.includes('src/app/app') ||
    norm.includes('src/app/start') ||
    norm.includes('src/app/(auth)') ||
    norm.includes('src/components/') ||
    (norm.includes('src/features/') && (norm.includes('-ui') || norm.includes('/ui/') || norm.includes('/components/')))

  return isIncluded
}

/**
 * 파일 내 AST 순회 및 금칙어 검출
 *
 * @param {string} filePath
 * @param {string} content
 * @param {Array} rules
 * @param {Array} [allowlist]
 * @returns {Array} violations
 */
export function scanSourceFile(filePath, content, rules, allowlist = []) {
  const normPath = filePath.replace(/\\/g, '/')
  const allowedEntry = allowlist.find(item => normPath.endsWith(item.file.replace(/\\/g, '/')))
  const allowedRuleSet = new Set(allowedEntry?.allowedRules || [])

  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )

  const violations = []
  /** 이미 UI/문구 맥락으로 처리한 리터럴 노드 (중복 보고 방지) */
  const handled = new Set()
  const seen = new Set()

  /**
   * 리터럴 말단(leaf) 1개를 검사한다.
   * @param leaf  collectCopyLeaves 결과 항목 또는 JsxText 래퍼
   * @param mode  'ui' | 'copy'
   */
  function reportLeaf(leaf, mode, contextDesc) {
    handled.add(leaf.node)
    const joined = leaf.texts.map(t => t.text).join(PART_SEPARATOR)
    if (!joined.trim()) return
    // 일반 위치('copy')에서는 한글 문구가 섞여 있을 때만 사용자 문구로 본다
    if (mode === 'copy' && !hasHangul(joined)) return
    // LLM 지시문(buildRetryPrompt 등)은 모델에게 보내는 내부 텍스트이므로 사용자 문구가 아니다
    if (mode === 'copy' && isLlmInstructionContext(leaf.node)) return

    const matches = matchText(joined, filePath, rules, { context: mode })
    for (const m of matches) {
      if (allowedRuleSet.has(m.ruleId)) continue

      // 조각별 위치 계산
      let cursor = 0
      let abs = leaf.texts[0].abs ?? leaf.node.getStart(sourceFile)
      for (const part of leaf.texts) {
        const len = part.text.length
        if (m.index <= cursor + len) {
          const local = Math.max(0, m.index - cursor)
          const base = part.abs ?? part.node.getStart(sourceFile) + (part.offset ?? 0)
          abs = base + local
          break
        }
        cursor += len + PART_SEPARATOR.length
      }
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(Math.min(abs, content.length))
      const key = `${line}:${character}:${m.ruleId}:${m.matched}`
      if (seen.has(key)) continue
      seen.add(key)

      violations.push({
        file: filePath,
        line: line + 1,
        column: character + 1,
        ruleId: m.ruleId,
        ruleName: m.ruleName,
        category: m.category,
        severity: m.severity,
        matched: m.matched,
        context: contextDesc,
        snippet: joined.replace(new RegExp(PART_SEPARATOR, 'g'), '${…}').trim().replace(/\s+/g, ' ').slice(0, 100),
      })
    }
  }

  function reportExpression(expr, mode, contextDesc) {
    for (const leaf of collectCopyLeaves(expr)) {
      const desc = leaf.kind && leaf.kind !== 'string' ? `${contextDesc} > ${leaf.kind}` : contextDesc
      reportLeaf(leaf, mode, desc)
    }
  }

  /** 라벨 맵 초기값: { ERROR: 'ERROR' } 처럼 키 → 문구 매핑의 모든 값을 UI 문구로 본다 */
  function reportLabelMap(expr, contextDesc, depth = 0) {
    if (depth > 4 || !expr) return
    let node = expr
    while (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node)
    ) {
      node = node.expression
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop)) {
          const key = propertyNameText(prop.name) ?? '[computed]'
          reportLabelMap(prop.initializer, `${contextDesc}[${key}]`, depth + 1)
        }
      }
    } else if (ts.isArrayLiteralExpression(node)) {
      for (const el of node.elements) reportLabelMap(el, contextDesc, depth + 1)
    } else {
      reportExpression(node, 'ui', contextDesc)
    }
  }

  function calleeNames(call) {
    const names = []
    let cur = call.expression
    while (cur) {
      if (ts.isPropertyAccessExpression(cur)) {
        names.unshift(cur.name.text)
        cur = cur.expression
      } else if (ts.isIdentifier(cur)) {
        names.unshift(cur.text)
        break
      } else {
        break
      }
    }
    return names
  }

  function visit(node) {
    // 1. JSXText (<p>텍스트</p>)
    if (ts.isJsxText(node)) {
      if (node.text.trim().length > 0) {
        reportLeaf({ node, kind: 'JSXText', texts: [{ node, text: node.text, abs: node.pos }] }, 'ui', 'JSXText')
      }
    }

    // 2. JSX 속성 (<Component aria-label="..." placeholder="..." title="..." />)
    else if (ts.isJsxAttribute(node)) {
      const attrName = node.name.getText(sourceFile)
      if (isUiJsxAttr(attrName) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) {
          reportExpression(node.initializer, 'ui', `JSXAttribute(${attrName.toLowerCase()})`)
        } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          reportExpression(node.initializer.expression, 'ui', `JSXAttribute(${attrName.toLowerCase()})`)
        }
      }
    }

    // 3. JSX 자식 표현식 (<span>{ "문자열" }</span>, {cond ? "A" : "B"}, {ok && "A"})
    else if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      if (node.expression) {
        reportExpression(node.expression, 'ui', 'JsxExpression')
      }
    }

    // 4. UI 객체 프로퍼티 할당 ({ label: '...', lineText: '...', status_label: '...' })
    else if (ts.isPropertyAssignment(node)) {
      const propName = propertyNameText(node.name)
      if (propName && isUiName(propName) && !isValidationIssueCode(node)) {
        const init = node.initializer
        if (ts.isObjectLiteralExpression(init)) {
          reportLabelMap(init, `Property(${propName})`)
        } else {
          reportExpression(init, 'ui', `Property(${propName})`)
        }
      }
    }

    // 5. 라벨 맵/문구 변수 (const STATUS_LABELS = { ERROR: 'ERROR' }, const message = cond ? 'A' : 'B')
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (isLabelMapName(node.name.text)) {
        reportLabelMap(node.initializer, `Label(${node.name.text})`)
      }
    }

    // 6. 라벨 함수 반환 (function statusLabel(s) { return 'ERROR' }, const toText = () => '...')
    else if (ts.isReturnStatement(node) && node.expression) {
      const fnName = enclosingFunctionName(node)
      if (fnName && isUiName(fnName)) {
        reportExpression(node.expression, 'ui', `Return(${fnName})`)
      }
    } else if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
      const fnName = enclosingFunctionName(node.body)
      if (fnName && isUiName(fnName)) {
        reportExpression(node.body, 'ui', `Return(${fnName})`)
      }
    }

    // 7. UI 호출 (toast('…'), alert('…'), setErrorMessage('…'))
    else if (ts.isCallExpression(node)) {
      const names = calleeNames(node)
      const last = names[names.length - 1] || ''
      const head = (names[0] || '').toLowerCase()
      if (UI_CALL_NAMES.test(last) || UI_SETTER.test(last) || UI_CALL_HEADS.has(head)) {
        for (const arg of node.arguments) {
          if (!ts.isObjectLiteralExpression(arg)) reportExpression(arg, 'ui', `Call(${names.join('.')})`)
        }
      }
    }

    // 8. 그 외 일반 위치의 문자열/템플릿: 코드 값(비교식·타입·import·case·로그 등)이 아니면 한글 문구 속 영문 상태어를 검사
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) &&
      !handled.has(node) &&
      !isCodeContext(node)
    ) {
      // JSX 속성 값 문자열은 위의 UI 속성 규칙으로만 판단 (className 등은 한글이 없어 영향 없음)
      reportExpression(node, 'copy', 'String')
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violations
}

/**
 * 하드코딩된 정상 확인 문구 경고 (조건 없이 "같아요/확인됨/정상" 을 단정하는 문구)
 * 경고 전용이며 CI 실패 조건이 아니다. 자세한 근거는 assurance.mjs 참고.
 */
export function scanSourceFileWarnings(filePath, content) {
  return scanAssuranceWarnings(filePath, content)
}

/**
 * 지정된 디렉토리 목록을 재귀 탐색하여 사용자 화면 파일 수집
 */
export function collectTargetFiles(rootDir) {
  const results = []

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        const dirName = entry.name
        if (
          dirName === 'node_modules' ||
          dirName === '.git' ||
          dirName === '.next' ||
          dirName === '.worktrees' ||
          dirName === 'dist' ||
          dirName === 'build'
        ) {
          continue
        }
        walk(fullPath)
      } else if (entry.isFile()) {
        const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/')
        if (isUserFacingPath(relPath)) {
          results.push(relPath)
        }
      }
    }
  }

  const searchRoots = [
    path.join(rootDir, 'src/app'),
    path.join(rootDir, 'src/components'),
    path.join(rootDir, 'src/features'),
  ]

  for (const sr of searchRoots) {
    if (fs.existsSync(sr)) {
      walk(sr)
    }
  }

  return results.sort()
}
