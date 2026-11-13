import assert from 'node:assert/strict'
import test from 'node:test'

import { sanitizeEvidence, summarize, verifyThresholds } from './verify-local-publish-spike.mjs'

test('summarizes success counts and rates by scenario', () => {
  assert.deepEqual(summarize([
    { scenario: 'single-image', ok: true },
    { scenario: 'single-image', ok: false },
    { scenario: 'text', ok: true },
  ]), {
    'single-image': { total: 2, succeeded: 1, rate: 0.5 },
    text: { total: 1, succeeded: 1, rate: 1 },
  })
})

test('keeps only allowlisted evidence and strips URL query secrets', () => {
  assert.deepEqual(sanitizeEvidence({
    channel: 'naver_blog', scenario: 'text', selectorVersion: 'naver-blog-v1', ok: true,
    resultUrl: 'https://blog.naver.com/findk3/123?token=never-log', cookie: 'never-log',
  }), {
    channel: 'naver_blog', scenario: 'text', selectorVersion: 'naver-blog-v1', ok: true,
    resultUrl: 'https://blog.naver.com/findk3/123',
  })
})

test('enforces the approved extension-first thresholds', () => {
  const evidence = [
    ...Array.from({ length: 10 }, () => ({ scenario: 'text', ok: true })),
    ...Array.from({ length: 10 }, () => ({ scenario: 'single-image', ok: true })),
    ...Array.from({ length: 9 }, () => ({ scenario: 'multi-image', ok: true })),
    { scenario: 'multi-image', ok: false },
  ]
  assert.deepEqual(verifyThresholds(evidence), { ok: true, failures: [] })
})
