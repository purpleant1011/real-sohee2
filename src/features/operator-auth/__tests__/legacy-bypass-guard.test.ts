import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const src = join(process.cwd(), 'src')
const legacyNameFile = 'features/operator-auth/legacy-cookie-name.ts'
const prohibitedSymbols = [
  'MASTER_ADMIN',
  'master-admin',
  'sohee_master_admin_session',
  'isMasterAdminCredentials',
  'verifyMasterAdminSession',
  'setMasterAdminSessionCookie',
  'createMasterAdminToken',
  'REVIEW_PLATFORM_OPERATOR_CONTEXT',
  'PERMANENT_HARDCODED',
]

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx|js|jsx)$/u.test(entry.name) && !/\.(?:test|spec)\./u.test(entry.name) ? [path] : []
  })
}

describe('obsolete administrator bypass cannot re-enter production source', () => {
  it('has no old symbols, credentials, or cookie acceptance in non-test source', () => {
    for (const path of sourceFiles(src)) {
      const name = relative(src, path)
      const contents = readFileSync(path, 'utf8')
      for (const symbol of prohibitedSymbols) {
        if (name === legacyNameFile && symbol === 'sohee_master_admin_session') continue
        expect(contents, `${name} contains ${symbol}`).not.toContain(symbol)
      }
      if (name !== 'features/admin/customer-360-canonical-service.ts') {
        expect(contents, `${name} contains the retired administrator address`).not.toContain('admin@example.com')
      }
    }
  }, 120_000)
})
