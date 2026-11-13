import { spawn, spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

const [psql, socket] = process.argv.slice(2)
const args = ['-X', '-h', socket, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
const current = spawnSync(psql, [...args, '-At', '-c', 'select id::text || chr(124) || fingerprint from public.content_versions where version_number = 2'], { encoding: 'utf8' })
assert.equal(current.status, 0, current.stderr)
const [id, fingerprint] = current.stdout.trim().split('|')
function attempt(text) {
  return new Promise((resolve, reject) => {
    const child = spawn(psql, [...args, '-c', `begin; select set_config('test.allowed','yes',false); select public.create_naver_block_revision('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','${id}','${fingerprint}',1,'${text}'); select pg_sleep(0.2); commit;`])
    let error = ''
    child.stdout.resume()
    child.stderr.on('data', data => { error += data })
    child.on('error', reject)
    child.on('close', code => resolve({ code, error }))
  })
}
const results = await Promise.all([attempt('기기 하나'), attempt('기기 둘')])
assert.equal(results.filter(result => result.code === 0).length, 1, JSON.stringify(results))
assert.match(results.find(result => result.code !== 0).error, /40001/)
const count = spawnSync(psql, [...args, '-At', '-c', 'select count(*) from public.content_versions'], { encoding: 'utf8' })
assert.equal(count.stdout.trim(), '3')
console.log('Concurrent device writes: one new version, one serialization conflict (40001)')
