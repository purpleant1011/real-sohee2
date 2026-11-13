// vitest runner: these contract tests must run under `npm test` (CI), so they
// use vitest's describe/it. Assertions stay on node:assert/strict.
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import {
  resolveLocalPublicEnv,
  verifyBuiltClientPublicEnv,
} from './local-public-env.mjs'

describe('verify-cloudflare-build contract (ANI-1591)', () => {
  const wranglerProductionText = `{
    "vars": {
      "NEXT_PUBLIC_SUPABASE_URL": "https://your-project-ref.supabase.co",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "sb_publishable_fixture"
    }
  }`

  const clientArtifacts = [
    'https://your-project-ref.supabase.co',
    'sb_publishable_fixture',
  ]

  it('purpose 누락 시 verify-cloudflare-build 환경 준비는 fail-closed로 차단된다', () => {
    assert.throws(
      () => resolveLocalPublicEnv({}, wranglerProductionText),
      (err) => {
        assert(err instanceof Error)
        assert(err.message.includes('[SECURITY FAIL-CLOSED]'))
        assert(err.message.includes('options.purpose를 명시해야 합니다'))
        return true
      }
    )
  })

  it('purpose: artifact-verify 지정 시 빌드 아티팩트 공개 환경 검증이 정상 통과한다', () => {
    // Exact replication of scripts/verify-cloudflare-build.mjs:44-48
    let envToCheck = {}
    if (!envToCheck.NEXT_PUBLIC_SUPABASE_URL) {
      envToCheck = resolveLocalPublicEnv(envToCheck, wranglerProductionText, {
        purpose: 'artifact-verify',
      })
    }

    assert.equal(
      envToCheck.NEXT_PUBLIC_SUPABASE_URL,
      'https://your-project-ref.supabase.co'
    )
    assert.equal(
      envToCheck.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      'sb_publishable_fixture'
    )

    // Ensure verifyBuiltClientPublicEnv accepts the resolved env
    assert.doesNotThrow(() => {
      verifyBuiltClientPublicEnv(clientArtifacts, envToCheck)
    })
  })
})
