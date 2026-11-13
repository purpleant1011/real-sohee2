import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

describe('ANI-1119: Legacy ImageWorker / dall-e-3 Total Production Purge', () => {
  const rootDir = process.cwd()

  it('verifies wrangler.jsonc specifies OPENAI_IMAGE_MODEL as gpt-image-2.5-sunburst (zero dall-e-3)', () => {
    const wranglerPath = path.resolve(rootDir, 'wrangler.jsonc')
    const wranglerContent = fs.readFileSync(wranglerPath, 'utf8')

    expect(wranglerContent).not.toMatch(/"OPENAI_IMAGE_MODEL":\s*"dall-e-3"/)
    expect(wranglerContent).toMatch(/"OPENAI_IMAGE_MODEL":\s*"gpt-image-2\.5-sunburst"/)
  })

  it('scans all production files under src/ to ensure zero hardcoded "dall-e-3" models', async () => {
    // Git skips generated/ignored files; fallback to fs traversal if git is unavailable.
    let srcFiles: string[] = []
    try {
      srcFiles = execFileSync('git', [
        'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'src',
      ], { cwd: rootDir, encoding: 'utf8' })
        .split('\0')
        .filter((file) =>
          /\.(ts|tsx|js|mjs)$/.test(file) &&
          !/(^|\/)__tests__\//.test(file) &&
          !/(^|\/)node_modules\//.test(file) &&
          !/\.(test|spec)\.(ts|tsx)$/.test(file) &&
          file.length > 0 &&
          fs.existsSync(path.resolve(rootDir, file))
        )
        .map((file) => path.resolve(rootDir, file))
    } catch {
      function getFiles(dir: string): string[] {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        const files: string[] = []
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            if (entry.name !== '__tests__' && entry.name !== 'node_modules') {
              files.push(...getFiles(fullPath))
            }
          } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) {
            files.push(fullPath)
          }
        }
        return files
      }
      srcFiles = getFiles(path.resolve(rootDir, 'src'))
    }

    const checkResults = await Promise.all(
      srcFiles.map(async (file) => {
        const content = await fsPromises.readFile(file, 'utf8')
        if (content.includes('dall-e-3')) {
          return { file: path.relative(rootDir, file), match: 'dall-e-3' }
        }
        return null
      })
    )

    const violatingFiles = checkResults.filter((result): result is { file: string; match: string } => result !== null)

    expect(violatingFiles).toEqual([])
  }, 60000)

  it('verifies user-facing chat route contains zero ImageWorker callsites', () => {
    const chatRoutePath = path.resolve(
      rootDir,
      'src/app/api/workspaces/[workspaceId]/agent/chat/route.ts'
    )
    const content = fs.readFileSync(chatRoutePath, 'utf8')

    expect(content).not.toContain('ImageWorker')
    expect(content).not.toMatch(/from\s+['"].*image-worker['"]/)
  })

  it('verifies content dispatcher contains zero ImageWorker callsites', () => {
    const dispatcherPath = path.resolve(
      rootDir,
      'src/features/tool-runtime/dispatchers/content-dispatcher.ts'
    )
    const content = fs.readFileSync(dispatcherPath, 'utf8')

    expect(content).not.toContain('ImageWorker.generateImage')
    expect(content).not.toMatch(/from\s+['"].*image-worker['"]/)
  })

  it('verifies agent-orchestrator contains zero ImageWorker imports', () => {
    const orchestratorPath = path.resolve(
      rootDir,
      'src/lib/agent-os/agent-orchestrator.ts'
    )
    const content = fs.readFileSync(orchestratorPath, 'utf8')

    expect(content).not.toMatch(/import\s+.*ImageWorker.*from\s+['"].*image-worker['"]/)
  })

  it('verifies dependency-cruiser configuration forbids image-worker in production routes', () => {
    const depCruiserPath = path.resolve(rootDir, '.dependency-cruiser.cjs')
    const content = fs.readFileSync(depCruiserPath, 'utf8')

    // Rule must target real image-worker.ts rather than dummy legacy-image-worker.ts
    expect(content).toContain('no-legacy-imageworker-in-production-chat')
    expect(content).toContain('src/lib/ai/image-worker')
  })
})
