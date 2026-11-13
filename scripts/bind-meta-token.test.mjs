// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('legacy binding exits with OAuth guidance without exposing tokens or publishing', () => {
  const secret = 'test-only-token-must-never-be-printed'
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL('./bind-meta-token.mjs', import.meta.url))], {
      env: { ...process.env, META_PROVIDER_ACCESS_TOKEN: secret }, encoding: 'utf8', stdio: 'pipe',
    })
    throw new Error('Manual binding must not succeed')
  } catch (error) {
    expect(error.status).toBe(1)
    expect(error.stderr).toContain('공식 연동')
    expect(error.stderr).toContain('https://example.com/app/channels')
    expect(`${error.stdout}${error.stderr}`).not.toContain(secret)
  }
})
