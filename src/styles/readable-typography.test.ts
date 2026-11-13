import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pwaViewport } from '@/features/pwa/metadata'

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

function expectRule(css: string, selector: string, declarations: readonly string[]) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const rule = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'u'))?.[1]
  expect(rule, `${selector} 규칙이 있어야 합니다.`).toBeDefined()
  for (const declaration of declarations) expect(rule).toContain(declaration)
}

function extractMediaQueryBlock(css: string, queryHeader: string): string {
  const start = css.indexOf(queryHeader)
  expect(start, `${queryHeader} 미디어 쿼리가 있어야 합니다.`).toBeGreaterThanOrEqual(0)
  const openBrace = css.indexOf('{', start)
  let depth = 1
  let current = openBrace + 1
  while (depth > 0 && current < css.length) {
    if (css[current] === '{') depth++
    else if (css[current] === '}') depth--
    current++
  }
  return css.slice(openBrace + 1, current - 1)
}

const tokens = read('src/styles/v07-tokens.css')
const conversation = read('src/features/chat/conversation-shell.module.css')
const conversationResults = read('src/features/chat/channel-result-card.module.css')
const content = read('src/features/content/content.module.css')
const periodPlan = read('src/features/plans/period-plan-card.module.css')
const schedule = read('src/features/schedule/schedule-board.module.css')

describe('readable product typography', () => {
  it('defines one restrained type scale for content-heavy product surfaces', () => {
    expect(tokens).toContain('--sohee-type-page-title-size: clamp(1.5rem, 2.6vw, 2rem);')
    expect(tokens).toContain('--sohee-type-card-title-size: 0.9375rem;')
    expect(tokens).toContain('--sohee-type-body-size: 0.875rem;')
    expect(tokens).toContain('--sohee-type-meta-size: 0.75rem;')
    expect(tokens).toContain('--sohee-type-page-title-weight: 700;')
    expect(tokens).toContain('--sohee-type-card-title-weight: 650;')
    expect(tokens).toContain('--sohee-type-body-weight: 450;')
    expect(tokens).toContain('--sohee-type-body-leading: 1.62;')
    expect(tokens).toContain('--sohee-type-readable-measure: 66ch;')
  })

  it('uses the shared hierarchy in conversation text and result cards', () => {
    expectRule(conversation, '.messageCard > p', [
      'font-size: var(--sohee-type-body-size);',
      'font-weight: var(--sohee-type-body-weight);',
      'line-height: var(--sohee-type-body-leading);',
    ])
    expectRule(conversationResults, '.resultHeader h3', [
      'font-size: var(--sohee-type-card-title-size);',
      'font-weight: var(--sohee-type-card-title-weight);',
    ])
    expectRule(periodPlan, '.header h2', [
      'font-size: var(--sohee-type-card-title-size);',
      'font-weight: var(--sohee-type-card-title-weight);',
      'word-break: keep-all;',
    ])
    expectRule(periodPlan, '.goal p', [
      'font-size: var(--sohee-type-body-size);',
      'font-weight: var(--sohee-type-body-weight);',
      'line-height: var(--sohee-type-body-leading);',
    ])
  })

  it('uses the shared hierarchy in work and schedule cards', () => {
    expectRule(content, '.detailHeader h1', [
      'font-size: var(--sohee-type-page-title-size);',
      'font-weight: var(--sohee-type-page-title-weight);',
    ])
    expectRule(content, '.cardTitle', [
      'font-size: var(--sohee-type-card-title-size);',
      'font-weight: var(--sohee-type-card-title-weight);',
      'word-break: keep-all;',
    ])
    expectRule(schedule, '.activityBody h3', [
      'font-size: var(--sohee-type-card-title-size);',
      'font-weight: var(--sohee-type-card-title-weight);',
      'word-break: keep-all;',
    ])
    expectRule(schedule, '.activityBody > p', [
      'font-size: var(--sohee-type-body-size);',
      'font-weight: var(--sohee-type-body-weight);',
      'line-height: var(--sohee-type-body-leading);',
    ])
  })

  it('enforces mobile chat inputs and textareas font-size >= 1rem (16px) to prevent iOS Safari auto-zoom', () => {
    const mobileBlock = extractMediaQueryBlock(conversation, '@media (max-width: 759px)')

    // 1. Mobile composer textarea must use font-size: 1rem (never <16px / 0.85rem)
    expectRule(mobileBlock, '.composerField textarea', [
      'font-size: 1rem;',
    ])

    // 2. Mobile interview card textarea & image preferences must use font-size: 1rem
    expectRule(mobileBlock, '.interviewFreeText', [
      'font-size: 1rem;',
    ])
    expectRule(mobileBlock, '.imagePreferenceBar select,\n  .imagePreferenceBar input', [
      'font-size: 1rem;',
    ])

    // 3. Mobile owner work/approve form inputs & textareas must use font-size: 1rem
    expectRule(mobileBlock, '.partialInstruction textarea,\n  .partialInstruction select,\n  .partialInstruction input,\n  .publishConfirmation input[type=\'datetime-local\']', [
      'font-size: 1rem;',
    ])

    // 4. Desktop baseline rules remain untouched (compact typography on large screens)
    expectRule(conversation, '.interviewFreeText', [
      'font-size: 0.8rem;',
    ])
    expectRule(conversation, '.imagePreferenceBar select,\n.imagePreferenceBar input', [
      'font-size: 0.72rem;',
    ])
    expectRule(conversation, '.partialInstruction textarea,\n.partialInstruction select,\n.publishConfirmation input[type=\'datetime-local\']', [
      'font-size: 0.78rem;',
    ])

    // 5. Parse all rules affecting textarea, input, and select in mobileBlock
    // and verify no rule sets font-size below 1rem (e.g. 0.xxrem or <16px)
    const ruleRegex = /([^{}]+)\{([^}]*)\}/gu
    let match: RegExpExecArray | null
    const subRemFontDeclarations: Array<{ selector: string; fontSize: string }> = []

    while ((match = ruleRegex.exec(mobileBlock)) !== null) {
      const selector = match[1].trim()
      const declarations = match[2]

      // Check if rule targets textarea, input (except checkbox/radio/file), or select
      const targetsInteractiveTextInput = /(?:textarea|\binput\b|\bselect\b|\.interviewFreeText|\.composerField|\.partialInstruction)/u.test(selector) &&
        !/type=['"]?(?:checkbox|radio|file)['"]?/u.test(selector)

      if (targetsInteractiveTextInput) {
        const fontMatch = declarations.match(/font(?:-size)?:\s*([^;]+);/u)
        if (fontMatch) {
          const value = fontMatch[1].trim()
          // Check for sub-1rem rem values like 0.85rem, 0.78rem, etc.
          const remMatch = value.match(/(0\.\d+)rem/u)
          if (remMatch && Number.parseFloat(remMatch[1]) < 1) {
            subRemFontDeclarations.push({ selector, fontSize: value })
          }
          // Check for px values below 16px
          const pxMatch = value.match(/(\d+(?:\.\d+)?)px/u)
          if (pxMatch && Number.parseFloat(pxMatch[1]) < 16) {
            subRemFontDeclarations.push({ selector, fontSize: value })
          }
        }
      }
    }

    expect(
      subRemFontDeclarations,
      `모바일(<=759px) 대화 입력창의 font-size는 iOS Safari 자동 줌(16px 미만) 방지를 위해 1rem(16px) 이상이어야 합니다: ${JSON.stringify(subRemFontDeclarations)}`,
    ).toEqual([])

    // 6. Accessibility guard: viewport maximum-scale must NOT be used to prevent zoom disabling
    expect(pwaViewport.maximumScale).toBeUndefined()
    expect(pwaViewport.userScalable).toBeUndefined()
  })
})
