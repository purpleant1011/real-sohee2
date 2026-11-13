import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function findSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') continue
      files.push(...findSourceFiles(fullPath))
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
      if (!entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx') && !entry.name.endsWith('.spec.ts')) {
        files.push(fullPath)
      }
    }
  }
  return files
}

describe('engagement-run logging invariant', () => {
  it('fails if any file containing the string [engagement-run] uses console.info or console.log for it', () => {
    const srcDir = path.resolve(process.cwd(), 'src')
    const sourceFiles = findSourceFiles(srcDir)
    const violations: { file: string; line: number; text: string }[] = []

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8')
      if (!content.includes('[engagement-run]')) continue
      const lines = content.split('\n')
      lines.forEach((text, idx) => {
        if (text.includes('[engagement-run]') && /console\.(info|log)\s*\(/.test(text)) {
          violations.push({ file: path.relative(process.cwd(), file), line: idx + 1, text: text.trim() })
        }
      })
    }

    expect(violations).toEqual([])
  })
})
