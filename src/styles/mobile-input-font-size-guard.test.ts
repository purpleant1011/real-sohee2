import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pwaViewport } from '@/features/pwa/metadata'

/**
 * 모바일 입력창 폰트 크기 가드 (iOS Safari 자동 줌·팬 방지).
 *
 * iOS Safari는 <input>, <textarea>, <select> 요소 포커스 시
 * 계산된 font-size가 16px 미만일 경우 화면을 강제 자동 확대(auto-zoom)하고
 * 좌우로 레이아웃이 밀리는(horizontal pan) 현상이 발생합니다.
 *
 * 이 가드는:
 * 1) UI 기본 컴포넌트(Input, Textarea, SelectTrigger)의 기본 모바일 폰트 크기 >= 16px (text-base md:text-sm) 보장
 * 2) globals.css 내 모바일 폼 컨트롤 16px 베이스 규칙 존재 검증
 * 3) Viewport 메타데이터가 줌을 비활성화하지 않는지(접근성) 검증
 * 4) src 내 모든 TSX / CSS 파일에서 모바일 폼 컨트롤에 16px 미만 폰트 크기 클래스/규칙 사용을 감지하여 차단
 *    (기존 정당화된 레거시 데스크톱 전용 화면 등은 mobile-input-font-size-legacy.txt allowlist로 관리하며 축소만 허용)
 */

const ROOT = join(__dirname, '..', '..')
const SRC = join(ROOT, 'src')

const LEGACY_PATH = join(__dirname, 'mobile-input-font-size-legacy.txt')
const legacy = new Set(
  readFileSync(LEGACY_PATH, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean),
)

function walk(dir: string, extensions: readonly string[], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'dist') continue
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walk(full, extensions, out)
    } else if (extensions.some(ext => name.endsWith(ext)) && !name.includes('.test.')) {
      out.push(full)
    }
  }
  return out
}

const SUB_16_CLASS_REGEX = /(?<![a-z0-9_-])text-(?:xs|sm|\[(?:[0-9]|1[0-5])(?:\.\d+)?px\]|\[0\.\d+rem\])(?![a-z0-9_-])/
const BASE_OR_LARGER_REGEX = /(?<![a-z0-9_-])text-(?:base|lg|xl|2xl|\[(?:1[6-9]|[2-9]\d)(?:\.\d+)?px\]|\[(?:1(?:\.\d+)?|[2-9](?:\.\d+)?)rem\])(?![a-z0-9_-])/

function isOffendingTsx(content: string): boolean {
  // Matches <input, <textarea, <select, <Input, <Textarea, <SelectTrigger
  const tagRegex = /<(input|textarea|select|Input|Textarea|SelectTrigger)\b([^>]*)/gu
  let match: RegExpExecArray | null
  while ((match = tagRegex.exec(content)) !== null) {
    const [, , attrs] = match

    // Skip non-textual input types
    if (/type=['"](?:checkbox|radio|file|hidden|color|range)['"]/iu.test(attrs)) {
      continue
    }

    // Skip SelectTrigger if it does not receive styling or is just self-contained
    // Extract className attributes
    const classMatch = attrs.match(/className=(?:\{`([^`]+)`\}|"([^"]+)"|'([^']+)'|\{cn\(([^)]+)\)\}|\{['"`]([^'"`]+)['"`]\})/u)
    if (!classMatch) continue

    const rawClass = classMatch[1] || classMatch[2] || classMatch[3] || classMatch[4] || classMatch[5] || ''
    const tokens = rawClass.split(/[\s,"'`]+/)

    let hasUnprefixedSub16 = false
    let hasUnprefixedBaseOrLarger = false

    for (const token of tokens) {
      if (!token) continue
      // Desktop breakpoint modifiers (md:, lg:, xl:, 2xl:) do not affect mobile
      if (/^(?:md|lg|xl|2xl):/u.test(token)) continue

      if (SUB_16_CLASS_REGEX.test(token)) {
        hasUnprefixedSub16 = true
      }
      if (BASE_OR_LARGER_REGEX.test(token)) {
        hasUnprefixedBaseOrLarger = true
      }
    }

    if (hasUnprefixedSub16 && !hasUnprefixedBaseOrLarger) {
      return true
    }
  }
  return false
}

function isOffendingCss(content: string): boolean {
  // Find rule blocks in CSS
  // Exclude @media (min-width: ...) which are desktop-only
  // Match rule blocks outside min-width queries
  const strippedDesktopMedia = content.replace(/@media\s*\(\s*min-width:[^{}]+\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gu, '')

  const ruleRegex = /([^{}]+)\{([^}]*)\}/gu
  let match: RegExpExecArray | null

  while ((match = ruleRegex.exec(strippedDesktopMedia)) !== null) {
    const selector = match[1].trim()
    const declarations = match[2]

    // Check if selector targets input, textarea, select, or dedicated text input class
    const isFormControlSelector =
      /(?:textarea|\binput\b|\bselect\b|\.textInput|\.searchInput|\.chatInput|\.numInput|\.selectInput)/u.test(selector) &&
      !/type=['"]?(?:checkbox|radio|file)['"]?/u.test(selector) &&
      !/user-select/u.test(selector)

    if (isFormControlSelector) {
      const fontMatch = declarations.match(/font(?:-size)?:\s*([^;]+);/u)
      if (fontMatch) {
        const val = fontMatch[1].trim()
        const remMatch = val.match(/(0\.\d+)rem/u)
        if (remMatch && Number.parseFloat(remMatch[1]) < 1) {
          return true
        }
        const pxMatch = val.match(/(\d+(?:\.\d+)?)px/u)
        if (pxMatch && Number.parseFloat(pxMatch[1]) < 16) {
          return true
        }
      }
    }
  }

  return false
}

describe('mobile input font-size guard (iOS Safari auto-zoom prevention)', () => {
  it('enforces UI base components have text-base md:text-sm for mobile readability', () => {
    const inputContent = readFileSync(join(SRC, 'components/ui/input.tsx'), 'utf8')
    const textareaContent = readFileSync(join(SRC, 'components/ui/textarea.tsx'), 'utf8')
    const selectContent = readFileSync(join(SRC, 'components/ui/select.tsx'), 'utf8')

    expect(inputContent).toContain('text-base')
    expect(inputContent).toContain('md:text-sm')

    expect(textareaContent).toContain('text-base')
    expect(textareaContent).toContain('md:text-sm')

    expect(selectContent).toContain('text-base')
    expect(selectContent).toContain('md:text-sm')
  })

  it('enforces globals.css contains mobile base rule for form controls', () => {
    const globalsCss = readFileSync(join(SRC, 'app/globals.css'), 'utf8')
    expect(globalsCss).toMatch(/@media\s*\(max-width:\s*759px\)/)
    expect(globalsCss).toMatch(/font-size:\s*(?:max\(1rem,\s*16px\)|1rem|16px)/)
  })

  it('verifies accessibility: viewport meta does not disable zoom', () => {
    expect(pwaViewport.maximumScale).toBeUndefined()
    expect(pwaViewport.userScalable).toBeUndefined()
  })

  it('scans all src TSX and CSS files for sub-16px mobile input font sizes', () => {
    const tsxFiles = walk(SRC, ['.tsx'])
    const cssFiles = walk(SRC, ['.css'])

    const tsxOffenders = tsxFiles
      .filter(f => isOffendingTsx(readFileSync(f, 'utf8')))
      .map(f => relative(ROOT, f))

    const cssOffenders = cssFiles
      .filter(f => isOffendingCss(readFileSync(f, 'utf8')))
      .map(f => relative(ROOT, f))

    const allOffenders = Array.from(new Set([...tsxOffenders, ...cssOffenders])).sort()

    // 1. Files outside legacy allowlist must have no sub-16px mobile inputs
    const unallowedOffenders = allOffenders.filter(r => !legacy.has(r))
    expect(
      unallowedOffenders,
      `모바일(<=759px) 폼 컨트롤(<input>, <textarea>, <select>)의 font-size는 iOS Safari 자동 줌(16px 미만) 방지를 위해 16px(1rem) 이상이어야 합니다. 다음 파일들이 위반되었습니다:\n${unallowedOffenders.join('\n')}`,
    ).toEqual([])

    // 2. Shrinking allowlist guard: cleaned up files must be removed from legacy allowlist
    const offenderSet = new Set(allOffenders)
    const staleLegacyEntries = [...legacy].filter(r => !offenderSet.has(r))
    expect(
      staleLegacyEntries,
      `수정이 완료되어 더 이상 위반하지 않는 파일은 mobile-input-font-size-legacy.txt 에서 제거해야 합니다:\n${staleLegacyEntries.join('\n')}`,
    ).toEqual([])
  })
})
