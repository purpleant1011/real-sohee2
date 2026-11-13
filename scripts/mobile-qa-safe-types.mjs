import { readFile, writeFile, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const marker = '__soheeMobileQaAtomicTypeWrite'
export function patchTypegenSource(source) {
  if (source.includes(`async function ${marker}(`)) return source
  const writer = 'await _fs.default.promises.writeFile('
  if (source.split(writer).length - 1 !== 3) throw new Error('Unrecognized Next type writer shape')
  const helper = `\nlet __soheeMobileQaTypeSequence = 0;\nasync function ${marker}(filePath, content) {\n  const temporary = filePath + '.mobile-qa-' + process.pid + '-' + (++__soheeMobileQaTypeSequence);\n  try {\n    await _fs.default.promises.writeFile(temporary, content);\n    await _fs.default.promises.rename(temporary, filePath);\n  } finally {\n    await _fs.default.promises.unlink(temporary).catch(() => {});\n  }\n}\n`
  return source.replaceAll(writer, `await ${marker}(`) + helper
}

async function run() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const localNext = join(root, 'node_modules', 'next')
  const actualNext = await realpath(localNext)
  if (actualNext !== localNext) throw new Error('QA requires a private Next dependency directory')
  const target = join(localNext, 'dist/server/lib/router-utils/route-types-utils.js')
  const original = await readFile(target, 'utf8')
  const patched = patchTypegenSource(original)
  if (patched !== original) await writeFile(target, patched)
  const child = spawn(process.execPath, [join(root, 'scripts/local-public-env.mjs'), ...process.argv.slice(2)], {
    cwd: root, env: process.env, stdio: 'inherit',
  })
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal))
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => { console.error(error.message); process.exitCode = 1 })
}
