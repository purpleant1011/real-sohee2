import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { globSync } from 'glob'

describe('ANI-1124: Production Fixture/Unsplash/Byreum Hardcode Total Purge & Test-Only Isolation', () => {
  const repoRoot = resolve(__dirname, '../..')
  const srcRoot = resolve(repoRoot, 'src')

  describe('Production Source Static Scan Gate', () => {
    it('ensures content-view.tsx contains ZERO SIX_REGISTERED_HARNESSES, ZERO unsplash.com URLs, and ZERO studio_by.reum', () => {
      const contentViewPath = resolve(srcRoot, 'app/app/content/content-view.tsx')
      expect(existsSync(contentViewPath)).toBe(true)
      const content = readFileSync(contentViewPath, 'utf-8')

      expect(content).not.toContain('SIX_REGISTERED_HARNESSES')
      expect(content).not.toContain('images.unsplash.com')
      expect(content).not.toContain('studio_by.reum')
      expect(content).not.toContain('바이름')
    })

    it('ensures content-detail-modal.tsx contains ZERO unsplash.com URLs, ZERO studio_by.reum, and ZERO 바이름', () => {
      const modalPath = resolve(srcRoot, 'components/v088/content/content-detail-modal.tsx')
      expect(existsSync(modalPath)).toBe(true)
      const content = readFileSync(modalPath, 'utf-8')

      expect(content).not.toContain('images.unsplash.com')
      expect(content).not.toContain('studio_by.reum')
      expect(content).not.toContain('바이름')
    })

    it('ensures automation-workspace.tsx contains ZERO studio_by.reum accounts', () => {
      const autoPath = resolve(srcRoot, 'features/automation/automation-workspace.tsx')
      expect(existsSync(autoPath)).toBe(true)
      const content = readFileSync(autoPath, 'utf-8')

      expect(content).not.toContain('@studio_by.reum')
    })

    it('ensures channel-health.tsx and system-trust-tabs.tsx contain ZERO @studio_by.reum and ZERO 바이름', () => {
      const healthPath = resolve(srcRoot, 'components/v088/command/channel-health.tsx')
      const trustPath = resolve(srcRoot, 'components/v088/system/system-trust-tabs.tsx')

      if (existsSync(healthPath)) {
        const content = readFileSync(healthPath, 'utf-8')
        expect(content).not.toContain('@studio_by.reum')
        expect(content).not.toContain('바이름')
      }
      if (existsSync(trustPath)) {
        const content = readFileSync(trustPath, 'utf-8')
        expect(content).not.toContain('@studio_by.reum')
        expect(content).not.toContain('바이름')
      }
    })

    it('ensures channel-publisher.ts contains ZERO @studio_by.reum in production URLs', () => {
      const pubPath = resolve(srcRoot, 'lib/publishing/channel-publisher.ts')
      if (existsSync(pubPath)) {
        const content = readFileSync(pubPath, 'utf-8')
        expect(content).not.toContain('@studio_by.reum')
      }
    })

    it('ensures sohee-master-mcp.ts contains ZERO images.unsplash.com and ZERO 바이름', () => {
      const mcpPath = resolve(srcRoot, 'lib/mcp/sohee-master-mcp.ts')
      if (existsSync(mcpPath)) {
        const content = readFileSync(mcpPath, 'utf-8')
        expect(content).not.toContain('images.unsplash.com')
        expect(content).not.toContain('studio_by.reum')
        expect(content).not.toContain('바이름')
      }
    })

    it('scans all user-facing UI files in src/app and src/components for forbidden Unsplash fallback images', () => {
      const uiFiles = globSync('src/{app,components}/**/*.{tsx,jsx}', {
        cwd: repoRoot,
        ignore: ['**/*.test.*', '**/__tests__/**'],
      })

      const violations: { file: string; match: string }[] = []
      for (const file of uiFiles) {
        const fullPath = resolve(repoRoot, file)
        const text = readFileSync(fullPath, 'utf-8')
        if (text.includes('images.unsplash.com')) {
          violations.push({ file, match: 'images.unsplash.com' })
        }
      }

      expect(violations).toEqual([])
    }, 20000)
  })

  describe('Test-Only Fixture Isolation', () => {
    it('verifies SIX_REGISTERED_HARNESSES exists in test fixture package/namespace', () => {
      const fixturePath = resolve(repoRoot, 'tests/fixtures/harness/six-registered-harnesses.ts')
      expect(existsSync(fixturePath)).toBe(true)
      const content = readFileSync(fixturePath, 'utf-8')
      expect(content).toContain('SIX_REGISTERED_HARNESSES')
    })
  })
})
