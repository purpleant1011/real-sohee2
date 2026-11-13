/**
 * 테스트 전용 최소 CSS 미디어 해석기 (ANI-1740).
 *
 * Desktop/Tablet 원기능 보존 회귀는 "768/820/1024/1440px 에서 어떤 규칙이 실제로 이기는가"에 달려 있다.
 * 브라우저 없이도 그 계약을 검증하려면 미디어 쿼리 적용 여부와 명시도(specificity) 우선순위를
 * 결정적으로 계산할 수 있어야 한다. 이 파일은 그 계산만 담당한다 — 제품 코드가 아니다.
 *
 * 지원 범위(의도적으로 좁게 유지한다):
 * - `@media` 는 `(min-width: Npx)` / `(max-width: Npx)` 를 `and` 로 이은 형태만 해석한다.
 * - 선택자 목록(`a, b { ... }`)과 클래스/속성/가상클래스/ID 명시도 비교.
 *
 * 해석할 수 없는 것은 **거짓(fail-closed)** 으로 판정한다. 해석 불가를 참으로 치환하면
 * 규칙이 사라져도 계약이 초록으로 남아 거짓 PASS 가 된다.
 */

export interface CssRule {
  /** `@media` 조건 문자열. 최상위 규칙이면 null. */
  media: string | null
  /** 선택자 목록을 쉼표로 분리한 값 */
  selectors: string[]
  declarations: Record<string, string>
}

/** 선택자 한 마디(compound)가 요구하는 것. */
interface Compound {
  ids: string[]
  classes: string[]
  attrs: string[]
  pseudoClasses: string[]
  element: string | null
}

const COMBINATOR = /[\s>+~]+/u
const WIDTH_FEATURE = /^\((min|max)-width:\s*(\d+)px\)$/u

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//gu, '')
}

/** 여는 중괄호 위치에서 짝이 맞는 닫는 중괄호 위치를 찾는다. */
function findBlockEnd(src: string, open: number): number {
  let depth = 1
  let i = open + 1
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') depth -= 1
    i += 1
  }
  return i - 1
}

function parseDeclarations(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const chunk of body.split(';')) {
    const idx = chunk.indexOf(':')
    if (idx === -1) continue
    const prop = chunk.slice(0, idx).trim()
    const value = chunk.slice(idx + 1).trim()
    if (!prop || !value) continue
    out[prop] = value
  }
  return out
}

/** CSS 파일을 규칙 목록으로 평탄화한다. `@media` 안쪽 규칙은 조건을 달고 나온다. */
export function extractRules(css: string, media: string | null = null): CssRule[] {
  const src = stripComments(css)
  const rules: CssRule[] = []
  let cursor = 0
  while (cursor < src.length) {
    const open = src.indexOf('{', cursor)
    if (open === -1) break
    const prelude = src.slice(cursor, open).trim()
    const close = findBlockEnd(src, open)
    const body = src.slice(open + 1, close)

    if (prelude.startsWith('@media')) {
      rules.push(...extractRules(body, prelude.replace(/^@media\s*/u, '').trim()))
    } else if (!prelude.startsWith('@')) {
      // @supports/@keyframes/@layer 등은 이 계약과 무관하므로 건너뛴다.
      rules.push({
        media,
        selectors: prelude.split(',').map((s) => s.trim()).filter(Boolean),
        declarations: parseDeclarations(body),
      })
    }
    cursor = close + 1
  }
  return rules
}

/**
 * 폭 하나에 대해 미디어 조건이 성립하는지.
 *
 * 미디어 목록(쉼표)은 OR 이므로 한 갈래라도 성립하면 참이다.
 * 각 갈래는 `(min-width: Npx)` / `(max-width: Npx)` 를 `and` 로 이은 것만 인정한다.
 * `print`, `screen`, `not`, `only` 처럼 해석하지 않는 토큰이 섞이면 그 갈래는 **성립하지 않음**으로 본다 —
 * `@media print and (min-width: 760px)` 를 화면 폭만 보고 참으로 치환하면
 * 데스크톱 레이아웃이 사라져도 계약이 초록으로 남는다.
 */
export function mediaMatches(media: string | null, width: number): boolean {
  if (!media) return true
  const branches = media.split(',').map((branch) => branch.trim()).filter(Boolean)
  if (branches.length === 0) return false

  return branches.some((branch) => {
    const parts = branch.split(/\s+and\s+/u).map((part) => part.trim())
    let matched = true
    for (const part of parts) {
      const feature = WIDTH_FEATURE.exec(part)
      // 해석 불가 토큰이 하나라도 있으면 이 갈래는 신뢰하지 않는다.
      if (!feature) return false
      const value = Number(feature[2])
      if (feature[1] === 'min' ? width < value : width > value) matched = false
    }
    return matched
  })
}

function parseCompound(compound: string): Compound {
  const withoutPseudoElements = compound.replace(/::[\w-]+(\([^)]*\))?/gu, '')
  return {
    ids: [...withoutPseudoElements.matchAll(/#([\w-]+)/gu)].map((m) => m[1]),
    classes: [...withoutPseudoElements.matchAll(/\.([\w-]+)/gu)].map((m) => m[1]),
    attrs: [...withoutPseudoElements.matchAll(/\[([^\]]*)\]/gu)].map((m) => m[1].trim()),
    pseudoClasses: [...withoutPseudoElements.matchAll(/(?<!:):([\w-]+)/gu)].map((m) => m[1]),
    element: /^([a-z][\w-]*)/u.exec(withoutPseudoElements.trim())?.[1] ?? null,
  }
}

/** 선택자의 마지막 마디 — 이 마디가 대상 요소와 맞아야 규칙이 적용된다. */
function lastCompound(selector: string): string {
  const parts = selector.trim().split(COMBINATOR).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

/**
 * 규칙 선택자가 대상 요소에 적용될 수 있는지.
 *
 * 정확한 문자열 일치가 아니라 **CSS 매칭**으로 본다. `.shell .mobileNav { display: grid }` 는
 * `.mobileNav` 요소에 적용되는 규칙이므로, 문자열이 다르다는 이유로 버리면
 * 실제 DOM 에서 이기는 선언을 놓쳐 계약이 거짓으로 초록이 된다(Codex 리뷰 지적).
 *
 * 조상 조건은 DOM 없이 판정할 수 없으므로 "성립할 수 있다"로 본다 — 이 계약은
 * "이 요소에 적용될 수 있는 규칙 중 무엇이 이기는가"를 묻기 때문이다.
 * 마지막 마디의 요구가 대상의 요구를 벗어나면(대상에 없는 클래스/ID/속성) 적용 불가로 본다.
 */
export function selectorApplies(selector: string, target: string): boolean {
  const targetCompound = parseCompound(target)
  if (targetCompound.element === null && !target.includes('#')) {
    // 대상은 클래스/속성 기준으로만 지정한다. 그 밖의 표기는 조용히 틀리느니 실패한다.
    if (!/[.#[]/u.test(target)) throw new Error(`대상 선택자 형식 오류: ${target}`)
  }
  if (COMBINATOR.test(target.trim())) {
    throw new Error(`대상은 단일 마디여야 합니다: ${target}`)
  }

  // 의사 요소(`::before` 등)는 요소 자체의 박스가 아니므로 이 계약의 대상이 아니다.
  if (selector.includes('::')) return false

  const rule = parseCompound(lastCompound(selector))
  if (rule.ids.some((id) => !targetCompound.ids.includes(id))) return false
  if (rule.classes.some((cls) => !targetCompound.classes.includes(cls))) return false
  if (rule.attrs.some((attr) => !targetCompound.attrs.includes(attr))) return false
  if (rule.pseudoClasses.some((pseudo) => !targetCompound.pseudoClasses.includes(pseudo))) return false
  if (rule.element && rule.element !== targetCompound.element) return false

  // 클래스/ID/속성으로 대상을 특정할 수 없는 규칙(`a`, `summary`, `*`)은
  // 대상이 클래스로만 주어졌을 때 귀속시킬 수 없다. 귀속시키면 모든 요소에 걸려
  // 엉뚱한 선언이 이긴다 — 조용히 틀리느니 적용 불가로 본다.
  const pinned = rule.ids.length + rule.classes.length + rule.attrs.length + rule.pseudoClasses.length > 0
  if (!pinned && targetCompound.element === null) return false
  return true
}

/** 선택자 명시도(근사). 이 계약에 등장하는 클래스/속성/가상클래스/ID 만 다룬다. */
export function selectorSpecificity(selector: string): number {
  const ids = (selector.match(/#[\w-]+/gu) ?? []).length
  const classes = (selector.match(/\.[\w-]+/gu) ?? []).length
  const attrs = (selector.match(/\[[^\]]*\]/gu) ?? []).length
  const pseudos = (selector.match(/::?[\w-]+/gu) ?? []).length
  const elements = (selector.match(/(?:^|[\s>+~])[a-z][\w-]*/gu) ?? []).length
  return ids * 10_000 + (classes + attrs + pseudos) * 100 + elements
}

/**
 * 주어진 폭에서 대상 요소에 최종 적용되는 선언을 계산한다.
 * 명시도가 높은 규칙이 이기고, 같으면 파일 뒤쪽 규칙이 이긴다(표준 캐스케이드).
 */
export function resolveDeclarations(
  css: string,
  targets: readonly string[],
  width: number,
): Record<string, string> {
  const winners = new Map<string, { value: string; spec: number; order: number }>()
  let order = 0
  for (const rule of extractRules(css)) {
    order += 1
    if (!mediaMatches(rule.media, width)) continue
    for (const selector of rule.selectors) {
      if (!targets.some((target) => selectorApplies(selector, target))) continue
      const spec = selectorSpecificity(selector)
      for (const [prop, value] of Object.entries(rule.declarations)) {
        const current = winners.get(prop)
        if (!current || spec > current.spec || (spec === current.spec && order >= current.order)) {
          winners.set(prop, { value, spec, order })
        }
      }
    }
  }
  return Object.fromEntries([...winners].map(([prop, winner]) => [prop, winner.value]))
}
