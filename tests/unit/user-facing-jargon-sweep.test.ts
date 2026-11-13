import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('Zero Internal Jargon in User-Facing Views (ANI-1458)', () => {
  const dir = path.join(process.cwd(), 'src/features/sohee-menu/components')
  const targetFiles = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => path.join('src/features/sohee-menu/components', f))

  it('contains zero forbidden internal jargon strings in JSX text', () => {
    const forbiddenPhrases = [
      'Delta Preview',
      'Figma',
      'Parity',
      '(Confirm)',
      'TEXT_HARNESS_CONFIRMED',
      'IMAGE_HARNESS_CONFIRMED',
      'OPERATING_POLICY_CONFIRMED',
      'BUSINESS_KNOWLEDGE_CONFIRMED',
      '텍스트 하네스',
      '이미지 하네스',
      '하네스 스냅샷',
      'HF-',
    ]

    for (const relPath of targetFiles) {
      const fullPath = path.join(process.cwd(), relPath)
      const content = fs.readFileSync(fullPath, 'utf8')

      // Strip code comments before checking user-visible strings
      const cleanedContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')

      for (const phrase of forbiddenPhrases) {
        expect(cleanedContent, `Forbidden phrase "${phrase}" found in ${relPath}`).not.toContain(phrase)
      }
    }
  })
})
