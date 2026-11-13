import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluateAlimtalkReadiness } from '@/features/kakao/notify/readiness'
import { ALIMTALK_TEMPLATE_LIST } from '@/features/kakao/notify/templates'

interface WranglerConfig {
  vars?: Record<string, string>
  [key: string]: unknown
}

function parseJsonc(content: string): WranglerConfig {
  const stripped = content.replace(
    /\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g,
    (m, g) => (g ? '' : m),
  )
  return JSON.parse(stripped) as WranglerConfig
}

function loadWranglerConfig(): WranglerConfig {
  const filePath = resolve(process.cwd(), 'wrangler.jsonc')
  const content = readFileSync(filePath, 'utf8')
  return parseJsonc(content)
}

describe('wrangler.jsonc kakao alimtalk configuration', () => {
  it('parses SOLAPI_TEMPLATE_IDS as a valid JSON object', () => {
    const config = loadWranglerConfig()
    const rawTemplateIds = config.vars?.SOLAPI_TEMPLATE_IDS

    expect(typeof rawTemplateIds).toBe('string')
    expect(rawTemplateIds!.trim().length).toBeGreaterThan(0)

    const templateMap = JSON.parse(rawTemplateIds!)
    expect(templateMap).not.toBeNull()
    expect(typeof templateMap).toBe('object')
    expect(Array.isArray(templateMap)).toBe(false)
  })

  it('matches exactly the 6 template codes from ALIMTALK_TEMPLATE_LIST', () => {
    const config = loadWranglerConfig()
    const rawTemplateIds = config.vars?.SOLAPI_TEMPLATE_IDS
    expect(rawTemplateIds).toBeDefined()

    const templateMap = JSON.parse(rawTemplateIds!) as Record<string, unknown>
    const expectedCodes = ALIMTALK_TEMPLATE_LIST.map((template) => template.code)

    expect(Object.keys(templateMap).sort()).toEqual([...expectedCodes].sort())
  })

  it('contains non-empty template IDs starting with KA01TP with no whitespace', () => {
    const config = loadWranglerConfig()
    const rawTemplateIds = config.vars?.SOLAPI_TEMPLATE_IDS
    expect(rawTemplateIds).toBeDefined()

    const templateMap = JSON.parse(rawTemplateIds!) as Record<string, unknown>

    for (const [code, templateId] of Object.entries(templateMap)) {
      expect(typeof templateId, `templateId for ${code} must be string`).toBe('string')
      const idStr = templateId as string
      expect(idStr.length, `templateId for ${code} must not be empty`).toBeGreaterThan(0)
      expect(idStr, `templateId for ${code} must not contain whitespace`).not.toMatch(/\s/)
      expect(idStr.startsWith('KA01TP'), `templateId for ${code} must start with KA01TP`).toBe(true)
    }
  })

  it('does not contain prohibited flags or secret keys in vars', () => {
    const config = loadWranglerConfig()
    const vars = config.vars ?? {}

    expect(vars).not.toHaveProperty('SOLAPI_ENABLED')
    expect(vars).not.toHaveProperty('KAKAO_OUTBOX_ENABLED')
    expect(vars).not.toHaveProperty('SOLAPI_API_KEY')
    expect(vars).not.toHaveProperty('SOLAPI_API_SECRET')
  })

  it('evaluates alimtalk readiness with empty unmappedTemplateCodes when passed SOLAPI_TEMPLATE_IDS', () => {
    const config = loadWranglerConfig()
    const rawTemplateIds = config.vars?.SOLAPI_TEMPLATE_IDS
    expect(rawTemplateIds).toBeDefined()

    const readiness = evaluateAlimtalkReadiness({
      SOLAPI_TEMPLATE_IDS: rawTemplateIds,
    })

    expect(readiness.unmappedTemplateCodes).toEqual([])
  })
})
