import ts from 'typescript'

/**
 * AST 컨텍스트 분류기 (ANI-1553 v2)
 *
 * 문자열이 "사용자 화면에 그대로 보이는 문구"인지, "코드가 쓰는 값(식별자/비교/타입/import/로그)"인지
 * 구문 트리로 판별한다. 단어 목록(rules.json)이 아무리 좋아도, 코드 값까지 위반으로 잡으면
 * 오탐 때문에 규칙을 끄게 되므로 이 모듈이 오탐을 줄이는 핵심 필터다.
 *
 * 분류 결과
 *  - 'ui'   : 사용자 화면 문구가 확실한 위치 (JSX 텍스트/속성/자식 표현식, UI 이름 프로퍼티, 라벨 맵, 라벨 함수 반환 등)
 *             → 영문 단독 토큰(예: 'ERROR')도 위반
 *  - 'code' : 코드 값이 확실한 위치 (import, 타입, 비교식, case, 요소 접근, 프로퍼티 키, 로그/console 인자 등)
 *             → 위반 아님
 *  - 'copy' : 위 둘이 아닌 일반 위치. 한글 문구에 영문 상태어가 섞인 경우만 위반 ('보관 ERROR · 외부 게시 ERROR')
 */

/** 이름 전체가 일치할 때 UI 문구로 보는 이름 (소문자 비교) */
const UI_EXACT_NAMES = new Set([
  'label',
  'title',
  'desc',
  'description',
  'hint',
  'placeholder',
  'subtitle',
  'heading',
  'text',
  'content',
  'prompt',
  'header',
  'caption',
  'summary',
  'alert',
  'message',
  'badge',
  'badgetext',
  'cta',
  'alt',
  'tooltip',
  'headline',
  'notice',
  'copy',
  'wording',
])

/** camelCase/snake_case/kebab-case 이름의 마지막 단어가 이 값이면 UI 문구로 본다 (lineText, ctaLabel, status_label 등) */
const UI_NAME_SUFFIXES = new Set([
  'label',
  'labels',
  'text',
  'texts',
  'title',
  'titles',
  'message',
  'messages',
  'description',
  'desc',
  'hint',
  'caption',
  'copy',
  'summary',
  'heading',
  'headline',
  'subtitle',
  'placeholder',
  'tooltip',
  'wording',
  'notice',
  'badge',
])

/** 값이 사용자에게 보이는 JSX 속성 (소문자). 접미사 규칙(…Label, …Text 등)은 별도 적용 */
const UI_JSX_ATTRS = new Set([
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'aria-placeholder',
  'aria-braillelabel',
  'placeholder',
  'title',
  'alt',
  'label',
  'description',
  'subtitle',
  'heading',
  'prompt',
  'caption',
  'helpertext',
  'emptytext',
  'badgetext',
  'errormessage',
  'tooltip',
])

/** 이름이 UI 문구용인지 (exact 또는 마지막 단어 접미사) */
export function isUiName(name) {
  if (!name || typeof name !== 'string') return false
  const lower = name.toLowerCase()
  if (UI_EXACT_NAMES.has(lower)) return true
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_\-]+/)
    .filter(Boolean)
  const last = words[words.length - 1]
  return last ? UI_NAME_SUFFIXES.has(last.toLowerCase()) : false
}

/** JSX 속성 이름이 사용자 노출 속성인지 */
export function isUiJsxAttr(attrName) {
  if (!attrName) return false
  const lower = attrName.toLowerCase()
  if (UI_JSX_ATTRS.has(lower)) return true
  // aria-labelledby / aria-describedby / aria-controls 등 id 참조 속성은 제외
  if (lower.startsWith('aria-')) return false
  // data-*, className, href, id, key, type, variant 등은 제외. 단 okText / cancelText / emptyText 같은 *Text|*Label 계열은 포함
  if (lower.startsWith('data-')) return false
  return isUiName(attrName)
}

const COMPARISON_OPERATORS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.InKeyword,
  ts.SyntaxKind.InstanceOfKeyword,
])

/** 값을 비교/검색하는 메서드 (인자는 코드 값) */
const COMPARISON_METHODS = new Set([
  'includes',
  'indexof',
  'lastindexof',
  'startswith',
  'endswith',
  'has',
  'test',
  'match',
  'matchall',
  'search',
  'localecompare',
  'equals',
  'hasown',
  'some',
  'every',
])

/** 로그/진단 객체 (인자는 개발자용 출력) */
const LOG_OBJECTS = new Set(['console', 'logger', 'log', 'debug', 'trace', 'telemetry', 'sentry'])

/** 로그 메서드 (객체가 무엇이든 인자는 개발자용 출력). error/warn은 toast.error 와 구분하려고 제외 */
const LOG_METHODS = new Set(['debug', 'trace'])

function unwrap(expr) {
  let cur = expr
  while (
    cur &&
    (ts.isParenthesizedExpression(cur) ||
      ts.isAsExpression(cur) ||
      ts.isSatisfiesExpression(cur) ||
      ts.isNonNullExpression(cur) ||
      ts.isTypeAssertionExpression(cur))
  ) {
    cur = cur.expression
  }
  return cur
}

/** 노드를 감싼 괄호/as/satisfies 래퍼를 건너뛴 가장 바깥 노드와 그 부모 */
function outermost(node) {
  let cur = node
  let parent = cur.parent
  while (
    parent &&
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isTypeAssertionExpression(parent)) &&
    parent.expression === cur
  ) {
    cur = parent
    parent = cur.parent
  }
  return { node: cur, parent }
}

/** 호출식의 콜리 이름 목록 (console.log -> ['console','log'], a.b.c() -> ['a','b','c']) */
function calleeChain(callee) {
  const chain = []
  let cur = unwrap(callee)
  while (cur) {
    if (ts.isPropertyAccessExpression(cur)) {
      chain.unshift(cur.name.text)
      cur = unwrap(cur.expression)
    } else if (ts.isElementAccessExpression(cur)) {
      cur = unwrap(cur.expression)
    } else if (ts.isIdentifier(cur)) {
      chain.unshift(cur.text)
      break
    } else if (cur.kind === ts.SyntaxKind.ThisKeyword) {
      chain.unshift('this')
      break
    } else {
      break
    }
  }
  return chain
}

/** 프로퍼티 이름 노드에서 문자열 이름 추출 (계산된 이름은 null) */
export function propertyNameText(nameNode) {
  if (!nameNode) return null
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) || ts.isNoSubstitutionTemplateLiteral(nameNode) || ts.isNumericLiteral(nameNode)) {
    return nameNode.text
  }
  return null
}

/** 가장 가까운 함수형 조상의 이름(함수 선언/변수 선언/메서드/프로퍼티 이름) */
export function enclosingFunctionName(node) {
  let cur = node.parent
  while (cur) {
    if (ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur) || ts.isGetAccessorDeclaration(cur)) {
      return cur.name ? propertyNameText(cur.name) : null
    }
    if (ts.isFunctionExpression(cur) || ts.isArrowFunction(cur)) {
      if (cur.name && ts.isIdentifier(cur.name)) return cur.name.text
      const { parent } = outermost(cur)
      if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
      if (parent && ts.isPropertyAssignment(parent)) return propertyNameText(parent.name)
      if (parent && ts.isPropertyDeclaration(parent)) return propertyNameText(parent.name)
      return null
    }
    cur = cur.parent
  }
  return null
}

/**
 * 문자열(또는 템플릿) 노드가 "코드 값" 위치인지 판별한다.
 * 이 위치의 문자열은 사용자 화면에 직접 나가지 않으므로 위반으로 보지 않는다.
 *  - import/export 모듈 경로, require/dynamic import
 *  - 타입 위치 (리터럴 타입, 템플릿 리터럴 타입)
 *  - 비교식 (status === 'ERROR', 'ERROR' !== x, in, instanceof)
 *  - switch case ('ERROR': ...)
 *  - 요소 접근 (obj['ERROR']) / 프로퍼티·열거 멤버 이름
 *  - 비교/검색 메서드 인자 (.includes('ERROR'), .has('ERROR') ...)
 *  - console.* / logger.* / log.* 등 로그 호출 인자
 *  - new RegExp(...) / Symbol(...) / JSON 키 같은 순수 코드 인자
 */
export function isCodeContext(node) {
  // 1. 타입 위치
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (ts.isTypeNode(cur) || ts.isTypeAliasDeclaration(cur) || ts.isInterfaceDeclaration(cur)) return true
    if (ts.isStatement(cur) || ts.isSourceFile(cur)) break
  }

  const { node: top, parent } = outermost(node)
  if (!parent) return false

  // 2. import / export / require / dynamic import
  if (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isExternalModuleReference(parent) ||
    ts.isImportTypeNode(parent) ||
    ts.isImportEqualsDeclaration(parent)
  ) {
    return true
  }

  // 3. 비교식
  if (ts.isBinaryExpression(parent) && COMPARISON_OPERATORS.has(parent.operatorToken.kind)) return true

  // 4. switch case
  if (ts.isCaseClause(parent) && parent.expression === top) return true

  // 5. 요소 접근 obj['KEY']
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === top) return true

  // 6. 프로퍼티/열거 멤버 이름
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isEnumMember(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent)) &&
    parent.name === top
  ) {
    return true
  }
  if (ts.isComputedPropertyName(parent)) return true

  // 7. 호출 인자
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.includes(top)) {
    const chain = calleeChain(parent.expression)
    if (chain.length > 0) {
      const head = chain[0].toLowerCase()
      const last = chain[chain.length - 1].toLowerCase()
      // 로그 출력
      if (LOG_OBJECTS.has(head) && chain.length > 1) return true
      if (LOG_METHODS.has(last)) return true
      // 비교/검색
      if (chain.length > 1 && COMPARISON_METHODS.has(last)) return true
      // 코드 전용 생성자/함수
      if (['require', 'regexp', 'symbol', 'urlsearchparams', 'headers', 'formdata'].includes(last)) return true
      if (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword) return true
    }
  }

  // 8. 태그드 템플릿 (css`...`, sql`...` 등)
  if (ts.isTaggedTemplateExpression(parent)) return true

  return false
}

/**
 * 표현식에서 "화면에 그대로 출력될 수 있는 문자열 말단"을 수집한다.
 *  - 문자열/템플릿 리터럴
 *  - 삼항 연산자의 양쪽 분기
 *  - ||, ?? 의 양쪽, && 의 오른쪽
 *  - 배열 요소
 *  - 괄호/as/satisfies 래퍼
 * 비교식(===)이나 함수 호출 결과 등은 수집하지 않는다.
 * @returns {Array<{ node: ts.Node, texts: Array<{ node: ts.Node, text: string, offset: number }>, kind: string }>}
 */
export function collectCopyLeaves(expr, kindPrefix = '') {
  const out = []
  const walk = (e, trail) => {
    const node = unwrap(e)
    if (!node) return
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      out.push({ node, kind: trail || 'string', texts: [{ node, text: node.text, offset: 1 }] })
    } else if (ts.isTemplateExpression(node)) {
      const texts = [{ node: node.head, text: node.head.text, offset: 1 }]
      for (const span of node.templateSpans) {
        texts.push({ node: span.literal, text: span.literal.text, offset: 1 })
      }
      out.push({ node, kind: trail ? `${trail} > template` : 'template', texts })
      // `${ok ? '정상' : 'ERROR'}` 처럼 조각 안 표현식의 문구도 같은 화면에 출력된다
      for (const span of node.templateSpans) {
        walk(span.expression, trail ? `${trail} > template-expr` : 'template-expr')
      }
    } else if (ts.isConditionalExpression(node)) {
      walk(node.whenTrue, trail ? `${trail} > ternary` : 'ternary')
      walk(node.whenFalse, trail ? `${trail} > ternary` : 'ternary')
    } else if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
        walk(node.left, trail ? `${trail} > fallback` : 'fallback')
        walk(node.right, trail ? `${trail} > fallback` : 'fallback')
      } else if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
        walk(node.right, trail ? `${trail} > and` : 'and')
      }
    } else if (ts.isArrayLiteralExpression(node)) {
      for (const el of node.elements) walk(el, trail ? `${trail} > array` : 'array')
    }
  }
  walk(expr, kindPrefix)
  return out
}

/**
 * zod `context.addIssue({ code: 'custom', message: 'MISSING_ERROR_CODE' })` 처럼
 * 검증 이슈의 message 자리에 쓰는 대문자 "에러 코드 토큰"인지.
 * 서버 쓰기 경로의 검증 코드이며 사용자 문구가 아니다. 한글/공백이 섞인 문구는 제외 대상이 아니다.
 * @param {ts.PropertyAssignment} prop
 */
export function isValidationIssueCode(prop) {
  const name = propertyNameText(prop.name)
  if (name !== 'message') return false
  const init = unwrap(prop.initializer)
  if (!init || !(ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init))) return false
  if (!/^[A-Z][A-Z0-9_]+$/.test(init.text)) return false
  const obj = prop.parent
  if (!obj || !ts.isObjectLiteralExpression(obj)) return false
  const call = obj.parent
  if (!call || !ts.isCallExpression(call) || !call.arguments.includes(obj)) return false
  const chain = calleeChain(call.expression)
  return chain[chain.length - 1] === 'addIssue'
}

/**
 * LLM 에게 보내는 지시문(프롬프트)을 만드는 함수 안의 문자열인지.
 * buildChannelRetryPrompt / systemInstruction 같은 이름의 함수·변수 안에서만 true.
 * 모델 입력용 텍스트는 사용자 화면에 직접 나가지 않는다.
 */
export function isLlmInstructionContext(node) {
  for (let cur = node.parent; cur; cur = cur.parent) {
    let name = null
    if (ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur)) name = cur.name ? propertyNameText(cur.name) : null
    else if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)) name = cur.name.text
    else if (ts.isPropertyAssignment(cur)) name = propertyNameText(cur.name)
    if (name && /prompt|instruction|systemmessage/i.test(name)) return true
  }
  return false
}

/** 한글 포함 여부 (일반 위치에서 "문구"로 볼 최소 근거) */
export function hasHangul(text) {
  return /[가-힣ㄱ-ㆎ]/.test(text)
}

/** 변수 선언 이름이 라벨 맵(STATUS_LABEL, errorCopy, messages 등)으로 보이는지 */
export function isLabelMapName(name) {
  return isUiName(name)
}
