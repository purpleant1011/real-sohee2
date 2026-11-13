import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { patchTypegenSource } from '../../../scripts/mobile-qa-safe-types.mjs'
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })
const fixture = `const _fs = { default: require('node:fs') };
async function routes(filePath, content) { await _fs.default.promises.writeFile(filePath, content); }
async function links(filePath, content) { await _fs.default.promises.writeFile(filePath, content); }
async function validator(filePath, content) { await _fs.default.promises.writeFile(filePath, content); }
module.exports = { routes, links, validator };`
it('patches only the known three Next type writers and is idempotent', () => {
  const patched = patchTypegenSource(fixture)
  expect(patched.match(/await __soheeMobileQaAtomicTypeWrite\(/g)).toHaveLength(3)
  expect(patchTypegenSource(patched)).toBe(patched)
})
it('fails closed when the SDK writer shape is not recognized', () => {
  expect(() => patchTypegenSource('module.exports = {}')).toThrow(/writer/i)
})
it('publishes one complete declaration when differently sized generations overlap', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sohee-atomic-types-'))
  directories.push(directory)
  const file = join(directory, 'routes.d.ts')
  const context = { require: createRequire(import.meta.url), process, module: { exports: {} } }
  runInNewContext(patchTypegenSource(fixture), context)
  const writer = context.module.exports as { routes: (file: string, content: string) => Promise<void> }
  const values = Array.from({ length: 40 }, (_, index) => `export type Route${index} = '${'x'.repeat(index % 2 ? 20000 : 20)}';\n`)
  await Promise.all(values.map(value => writer.routes(file, value)))
  expect(values).toContain(await readFile(file, 'utf8'))
})
