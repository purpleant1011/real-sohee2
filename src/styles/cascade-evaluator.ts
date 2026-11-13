import postcss, { type Root, type Rule } from 'postcss'
// @ts-expect-error jsdom types are not installed in devDependencies
import { JSDOM } from 'jsdom'

export type EvaluatedProperty = {
  property: string
  raw: string
  valueInPx: number | null
  selector: string
  specificity: number
  sourceOrder: number
  line?: number
  media: string | null
  important: boolean
}

export type CascadeOptions = {
  viewportWidth?: number
  remBase?: number
}

/**
 * Calculates CSS specificity (a, b, c) according to CSS Selectors Level 3/4.
 * a = ID selectors
 * b = class selectors, attribute selectors, pseudo-classes (excluding :not itself)
 * c = type selectors, pseudo-elements
 * Returns numeric score: a * 10000 + b * 100 + c
 */
export function calculateSpecificity(selector: string): number {
  let s = selector.trim()
  // Strip strings in quotes
  s = s.replace(/"[^"]*"/gu, '').replace(/'[^']*'/gu, '')

  // Extract inner selectors in :not(...)
  const innerNotSelectors: string[] = []
  s = s.replace(/:not\(([^)]+)\)/gu, (_, inner: string) => {
    innerNotSelectors.push(inner)
    return ' '
  })

  let idCount = (s.match(/#[a-zA-Z0-9_-]+/gu) || []).length
  let classCount = (s.match(/\.[a-zA-Z0-9_-]+/gu) || []).length
  let attrCount = (s.match(/\[[^\]]+\]/gu) || []).length
  let pseudoClassCount = (s.match(/:[a-zA-Z0-9_-]+/gu) || [])
    .filter(p => !p.startsWith('::')).length

  for (const inner of innerNotSelectors) {
    idCount += (inner.match(/#[a-zA-Z0-9_-]+/gu) || []).length
    classCount += (inner.match(/\.[a-zA-Z0-9_-]+/gu) || []).length
    attrCount += (inner.match(/\[[^\]]+\]/gu) || []).length
    pseudoClassCount += (inner.match(/:[a-zA-Z0-9_-]+/gu) || [])
      .filter(p => !p.startsWith('::')).length
  }

  const b = classCount + attrCount + pseudoClassCount

  const pseudoElemCount = (s.match(/::[a-zA-Z0-9_-]+/gu) || []).length
  const cleaned = s.replace(/::?[a-zA-Z0-9_-]+(?:\([^)]*\))?/gu, '')
    .replace(/#[a-zA-Z0-9_-]+/gu, '')
    .replace(/\.[a-zA-Z0-9_-]+/gu, '')
    .replace(/\[[^\]]+\]/gu, '')
    .replace(/[>+~*]/gu, ' ')
  let tagCount = (cleaned.match(/\b[a-zA-Z][a-zA-Z0-9]*\b/gu) || []).length

  for (const inner of innerNotSelectors) {
    const innerClean = inner.replace(/::?[a-zA-Z0-9_-]+(?:\([^)]*\))?/gu, '')
      .replace(/#[a-zA-Z0-9_-]+/gu, '')
      .replace(/\.[a-zA-Z0-9_-]+/gu, '')
      .replace(/\[[^\]]+\]/gu, '')
      .replace(/[>+~*]/gu, ' ')
    tagCount += (innerClean.match(/\b[a-zA-Z][a-zA-Z0-9]*\b/gu) || []).length
  }

  const c = tagCount + pseudoElemCount
  return idCount * 10000 + b * 100 + c
}

export function parseLengthToPx(val: string | null | undefined, remBase = 16): number | null {
  if (!val) return null
  const trimmed = val.trim()
  if (trimmed.endsWith('px')) {
    const parsed = parseFloat(trimmed)
    return isNaN(parsed) ? null : parsed
  }
  if (trimmed.endsWith('rem')) {
    const parsed = parseFloat(trimmed)
    return isNaN(parsed) ? null : parsed * remBase
  }
  if (trimmed.endsWith('em')) {
    const parsed = parseFloat(trimmed)
    return isNaN(parsed) ? null : parsed * remBase
  }
  return null
}

export function matchesMedia(mediaText: string | null, viewportWidth: number): boolean {
  if (!mediaText) return true
  // Support comma-separated media queries (OR logic)
  const parts = mediaText.split(',')
  return parts.some(part => {
    const maxWidthMatch = part.match(/\(max-width:\s*(\d+)px\)/u)
    if (maxWidthMatch && viewportWidth > parseInt(maxWidthMatch[1]!, 10)) {
      return false
    }
    const minWidthMatch = part.match(/\(min-width:\s*(\d+)px\)/u)
    if (minWidthMatch && viewportWidth < parseInt(minWidthMatch[1]!, 10)) {
      return false
    }
    return true
  })
}

type ParsedRuleItem = {
  index: number
  rule: Rule
  media: string | null
  line?: number
}

function collectRules(root: Root): ParsedRuleItem[] {
  let ruleIndex = 0
  const ruleList: ParsedRuleItem[] = []
  root.walkRules((rule) => {
    ruleIndex++
    let media: string | null = null
    let parent = rule.parent
    while (parent && parent.type !== 'root') {
      if (parent.type === 'atrule' && parent.name === 'media') {
        media = parent.params
        break
      }
      parent = parent.parent
    }
    ruleList.push({
      index: ruleIndex,
      rule,
      media,
      line: rule.source?.start?.line,
    })
  })
  return ruleList
}

/**
 * Parses CSS content and evaluates the winning declaration for `property`
 * on the element matching `targetSelector` within `htmlSnippet` at `viewportWidth`.
 * Cascade order: !important > specificity > source order.
 */
export function evaluateCascade(
  cssContent: string,
  htmlSnippet: string,
  targetSelector: string,
  property: string,
  options: CascadeOptions = {},
): EvaluatedProperty | null {
  const { viewportWidth = 390, remBase = 16 } = options

  const root = postcss.parse(cssContent)
  const ruleList = collectRules(root)

  const dom = new JSDOM(htmlSnippet)
  const el = dom.window.document.querySelector(targetSelector)
  if (!el) {
    throw new Error(`Element matching "${targetSelector}" was not found in provided HTML snippet.`)
  }

  const matched: EvaluatedProperty[] = []

  for (const item of ruleList) {
    if (!matchesMedia(item.media, viewportWidth)) continue

    let declVal: string | null = null
    let isImportant = false

    item.rule.walkDecls(property, (decl) => {
      declVal = decl.value
      if (decl.important) isImportant = true
    })

    if (!declVal) continue

    const selectors = item.rule.selectors || [item.rule.selector]
    for (const sel of selectors) {
      try {
        if (el.matches(sel)) {
          const spec = calculateSpecificity(sel)
          matched.push({
            property,
            raw: declVal,
            valueInPx: parseLengthToPx(declVal, remBase),
            selector: sel,
            specificity: spec,
            sourceOrder: item.index,
            line: item.line,
            media: item.media,
            important: isImportant,
          })
        }
      } catch {
        // Ignore selectors that jsdom cannot parse (e.g. unknown vendor pseudos)
      }
    }
  }

  if (matched.length === 0) return null

  // Sort: !important (asc), specificity (asc), sourceOrder (asc) -> winning rule is last
  matched.sort((a, b) => {
    if (a.important !== b.important) return a.important ? 1 : -1
    if (a.specificity !== b.specificity) return a.specificity - b.specificity
    return a.sourceOrder - b.sourceOrder
  })

  return matched[matched.length - 1] ?? null
}
