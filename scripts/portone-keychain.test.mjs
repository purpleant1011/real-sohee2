import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { userInfo } from 'node:os'
import { fileURLToPath } from 'node:url'

const helper = fileURLToPath(new URL('./portone-keychain.swift', import.meta.url))
const account = userInfo().username
const run = (mode, service, input = '') => spawnSync('/usr/bin/swift', [helper, mode, service, account], {
  input, encoding: 'utf8', timeout: 90000,
})

test('PortOne review secret is written from stdin, verified, never echoed, and not overwritten', () => {
  const service = `example.com/PORTONE_V2_REVIEW/fixture-${randomUUID()}`
  const fixture = `not-a-real-key-${randomUUID()}`
  try {
    const before = run('status', service)
    assert.equal(before.status, 0)
    assert.equal(JSON.parse(before.stdout).present, false)
    const write = run('store', service, fixture)
    assert.equal(write.status, 0)
    assert.deepEqual(JSON.parse(write.stdout), { stored: true, verified: true })
    assert.equal((write.stdout + write.stderr).includes(fixture), false)
    const status = run('status', service)
    assert.equal(status.status, 0)
    assert.equal(JSON.parse(status.stdout).present, true)
    const duplicate = run('store', service, `other-${randomUUID()}`)
    assert.notEqual(duplicate.status, 0)
    assert.equal(JSON.parse(duplicate.stdout).error, 'ITEM_EXISTS')
  } finally {
    // A timed-out/failed verification may still have stored this unique fixture.
    const state = run('status', service)
    assert.equal(state.status, 0)
    if (JSON.parse(state.stdout).present) {
      const cleanup = spawnSync('/usr/bin/security', ['delete-generic-password', '-a', account, '-s', service], { encoding: 'utf8' })
      assert.equal(cleanup.status, 0)
    }
  }
})

test('empty input and non-review storage targets are rejected without echoing input', () => {
  const service = `example.com/PORTONE_V2_REVIEW/fixture-${randomUUID()}`
  const empty = run('store', service)
  assert.notEqual(empty.status, 0)
  assert.equal(JSON.parse(empty.stdout).error, 'INVALID_SECRET')
  const invalid = run('store', 'example.com/PRODUCTION', 'not-a-real-key')
  assert.notEqual(invalid.status, 0)
  assert.equal(JSON.parse(invalid.stdout).error, 'INVALID_ARGUMENTS')
})
