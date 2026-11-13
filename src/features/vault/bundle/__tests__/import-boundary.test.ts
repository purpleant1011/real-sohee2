import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
          !entry.name.endsWith('.test.ts') &&
          !entry.name.endsWith('.test.tsx')
        ? [join(directory, entry.name)]
        : [],
  )
}

describe('ANI-1541 vault copy bundle import boundary', () => {
  it('does not import publishing, external provider clients, or OAuth modules into vault bundle', () => {
    const bundleDir = join(process.cwd(), 'src/features/vault/bundle')
    const sourceFiles = files(bundleDir)
    expect(sourceFiles.length).toBeGreaterThan(0)

    for (const filePath of sourceFiles) {
      const source = readFileSync(filePath, 'utf8')
      expect(
        source,
        `File ${filePath} violates the zero-external-call invariant`,
      ).not.toMatch(
        /(?:from\s*|import\s*\(|require\s*\()\s*['"`](@\/features\/(?:publishing|channels)\/|[^'"`]*(?:provider|oauth)[^'"`]*)/i,
      )
    }
  })
})
