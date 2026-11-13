import assert from 'node:assert/strict'
import { test } from 'node:test'

import { verifyRelease } from './verify-local-publish-release.mjs'

const allEvidence = Object.freeze({
  controlPlane: true,
  extensionBuild: true,
  macos: true,
  windows: true,
  scheduleBoundary: true,
  naverPrivateOrDraft: true,
  naverPublic: true,
  daangnPreflight: true,
  daangnPublic: true,
  unknownResultBlock: true,
  rollback: true,
})

test('release gate names the first missing platform evidence', () => {
  assert.throws(() => verifyRelease({ ...allEvidence, windows: false }), /windows evidence missing/)
})

test('release gate cannot turn code evidence into a public Naver result', () => {
  assert.throws(() => verifyRelease({ ...allEvidence, naverPublic: false }), /public Naver unverified/)
})

test('release gate passes only a complete evidence matrix', () => {
  assert.deepEqual(verifyRelease(allEvidence), { ok: true, verified: 11 })
})
