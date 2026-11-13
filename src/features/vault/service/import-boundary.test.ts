import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [join(directory, entry.name)] : [])
}

describe('ANI-1528 vault save import boundary', () => {
  it('does not import publishing, provider or OAuth modules into the vault service', () => {
    for (const path of files(join(process.cwd(), 'src/features/vault/service'))) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).not.toMatch(/(?:from\s*|import\s*\(|require\s*\()\s*['"`](@\/features\/(?:publishing|channels)\/|[^'"`]*(?:provider|oauth)[^'"`]*)/i)
    }
  })
})
