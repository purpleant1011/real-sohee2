// @vitest-environment node
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

describe('marketing strategy client boundary', () => {
  it('bundles interview and request schemas for browsers without server dependencies', async () => {
    const result = await build({
      entryPoints: ['src/features/chat/content-interview.ts', 'src/features/chat/chat-request-schema.ts'],
      bundle: true,
      platform: 'browser',
      write: false,
      outdir: 'client-boundary',
      logLevel: 'silent',
    })
    expect(result.outputFiles).toHaveLength(2)
  })
})
