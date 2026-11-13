// vitest runner: these contract tests must run under `npm test` (CI), so they
// use vitest's describe/it. Assertions stay on node:assert/strict.
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveMobileR2Enabled } from '../src/features/mobile-shell/r2-flag'
import { shouldOpenFirstPostRoute } from '../src/app/app/work/new/first-post-route-flag'
import * as publicEnv from './local-public-env.mjs'

const {
  resolveLocalPublicEnv,
  resolveCloudflareBuildEnv,
  verifyBuiltClientPublicEnv,
  isProductionSupabaseUrl,
  PRODUCTION_SUPABASE_REF,
} = publicEnv

describe('owner-only R2 Cloudflare build contract', () => {
  const flag = 'NEXT_PUBLIC_MOBILE_R2_FIRSTPOST'
  const owner = '00000000-0000-4000-8000-0000000000a1'
  const cheongna = '00000000-0000-4000-8000-0000000000a2'
  const publicVars = {
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_fixture',
  }
  const config = (value) => JSON.stringify({ vars: { ...publicVars, ...value } })

  it('선언한 공개 플래그만 빌드에 전달하고 임의 runtime vars는 복사하지 않는다', () => {
    const result = resolveCloudflareBuildEnv({}, config({ [flag]: 'on', PRIVATE_SENTINEL: 'not-public' }), 'local-sha')
    assert.equal(result[flag], 'on')
    assert.equal(Object.hasOwn(result, 'PRIVATE_SENTINEL'), false)
  })

  it('플래그가 없으면 명시적 off이며 호스트 환경만으로 켤 수 없다', () => {
    assert.equal(resolveCloudflareBuildEnv({}, config({}), 'local-sha')[flag], 'off')
    assert.throws(() => resolveCloudflareBuildEnv({ [flag]: 'on' }, config({}), 'local-sha'), /R2 first-post build flag conflicts/)
  })

  it.each(['on', 'off'])('동일한 명시 설정 %s는 서버 선언과 빌드에서 일치한다', (value) => {
    assert.equal(resolveCloudflareBuildEnv({ [flag]: value }, config({ [flag]: value }), 'local-sha')[flag], value)
  })

  it('호스트와 runtime 선언이 다르면 불일치 빌드를 거절한다', () => {
    assert.throws(() => resolveCloudflareBuildEnv({ [flag]: 'off' }, config({ [flag]: 'on' }), 'local-sha'), /R2 first-post build flag conflicts/)
  })

  it.each(['1', 'ON', 'true', '', ' on'])('잘못된 선언 %j를 on으로 추정하지 않는다', (value) => {
    assert.throws(() => resolveCloudflareBuildEnv({}, config({ [flag]: value }), 'local-sha'), /Invalid R2 first-post build flag/)
  })

  it('첫 포스팅 플래그도 브라우저 런타임 환경 변수에 남으면 아티팩트 검증이 실패한다', () => {
    assert.throws(() => verifyBuiltClientPublicEnv(
      [...Object.values(publicVars), `const flag = process.env.${flag}`],
      { ...publicVars, [flag]: 'on' },
    ), /Cloudflare client artifact still depends on runtime public environment variables/)
  })

  it('모바일 전체 공개 설정과 첫 포스팅 빌드를 일치시키고 allowlist 롤백 경로를 보존한다', () => {
    const text = readFileSync('wrangler.jsonc', 'utf8')
    const { vars } = JSON.parse(text)
    const approved = [owner, cheongna]
    assert.equal(vars.MOBILE_R2_UI_ENABLED, 'all')
    assert.equal(vars.MOBILE_R2_LANDING_ENABLED, '1')
    assert.equal(vars.MOBILE_R2_UI_WORKSPACE_ALLOWLIST, approved.join(','))
    assert.equal(vars[flag], 'on')
    const built = resolveCloudflareBuildEnv({}, text, 'local-sha')
    assert.equal(built[flag], 'on')
    for (const workspaceId of [...approved, '07884dcc-7716-4913-a6e5-f1e39c256457']) {
      const enabled = resolveMobileR2Enabled(vars.MOBILE_R2_UI_ENABLED, vars.MOBILE_R2_UI_WORKSPACE_ALLOWLIST, workspaceId)
      assert.equal(enabled, true)
      assert.equal(shouldOpenFirstPostRoute(enabled, built[flag]), true)
    }
    assert.equal(resolveMobileR2Enabled('1', '*', owner), false)
    assert.equal(resolveMobileR2Enabled('0', owner, owner), false)
  })
})

describe('local-public-env security guard (ANI-1591 / explicit purpose fail-closed)', () => {
  const wranglerProductionText = `{
    "vars": {
      "NEXT_PUBLIC_SUPABASE_URL": "https://your-project-ref.supabase.co",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "sb_publishable_fixture"
    }
  }`

  const wranglerLocalText = `{
    "vars": {
      "NEXT_PUBLIC_SUPABASE_URL": "http://127.0.0.1:54321",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "sb_publishable_local_fixture"
    }
  }`

  it('운영 Supabase 식별자를 올바르게 감지한다', () => {
    assert.equal(PRODUCTION_SUPABASE_REF, 'your-project-ref')
    assert.equal(isProductionSupabaseUrl('https://your-project-ref.supabase.co'), true)
    assert.equal(isProductionSupabaseUrl('https://app.example.com'), true)
    assert.equal(isProductionSupabaseUrl('http://127.0.0.1:54321'), false)
    assert.equal(isProductionSupabaseUrl('http://localhost:54321'), false)
    assert.equal(isProductionSupabaseUrl('https://test-sandbox.supabase.co'), false)
    assert.equal(isProductionSupabaseUrl(null), false)
  })

  it('옵션 없이 호출하면 운영 URL로의 자동 폴백을 즉시 차단한다 (FAIL-CLOSED 기본값)', () => {
    assert.throws(
      () => resolveLocalPublicEnv({}, wranglerProductionText),
      (err) => {
        assert(err instanceof Error)
        assert(err.message.includes('[SECURITY FAIL-CLOSED]'))
        assert(err.message.includes('운영 데이터 쓰기 및 오염 방지를 위해 차단되었습니다'))
        assert(err.message.includes('options.purpose를 명시해야 합니다'))
        return true
      }
    )
  })

  it('임의의 무효한 purpose가 전달되어도 fail-closed로 차단한다', () => {
    assert.throws(
      () => resolveLocalPublicEnv({}, wranglerProductionText, { purpose: 'arbitrary-unauthorized' }),
      (err) => {
        assert(err instanceof Error)
        assert(err.message.includes('[SECURITY FAIL-CLOSED]'))
        return true
      }
    )
  })

  it('환경 변수에 운영 URL이 주입되어도 authorized purpose 없이는 로컬 개발을 차단한다', () => {
    assert.throws(
      () =>
        resolveLocalPublicEnv(
          {
            NEXT_PUBLIC_SUPABASE_URL: 'https://your-project-ref.supabase.co',
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_pub_test',
          },
          wranglerProductionText
        ),
      (err) => {
        assert(err instanceof Error)
        assert(err.message.includes('[SECURITY FAIL-CLOSED]'))
        assert(err.message.includes('로컬 개발 환경에서 운영 DB 연결은 기본 차단됩니다'))
        return true
      }
    )
  })

  it('명시적 purpose: cloudflare-build 전달 시 배포 빌드용 설정을 정상 주입한다', () => {
    const result = resolveLocalPublicEnv({}, wranglerProductionText, {
      purpose: 'cloudflare-build',
    })
    assert.equal(result.NEXT_PUBLIC_SUPABASE_URL, 'https://your-project-ref.supabase.co')
    assert.equal(result.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'sb_publishable_fixture')
  })

  it('명시적 purpose: artifact-verify 전달 시 아티팩트 검증용 설정을 정상 읽는다', () => {
    const result = resolveLocalPublicEnv({}, wranglerProductionText, {
      purpose: 'artifact-verify',
    })
    assert.equal(result.NEXT_PUBLIC_SUPABASE_URL, 'https://your-project-ref.supabase.co')
    assert.equal(result.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'sb_publishable_fixture')
  })

  it('명시적 purpose: allow-production-read 옵션이 제공되면 운영 설정을 허용한다', () => {
    const result = resolveLocalPublicEnv({}, wranglerProductionText, {
      purpose: 'allow-production-read',
    })
    assert.equal(result.NEXT_PUBLIC_SUPABASE_URL, 'https://your-project-ref.supabase.co')
    assert.equal(result.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'sb_publishable_fixture')
  })

  it('로컬 개발용 비운영 URL(http://127.0.0.1:54321)이 환경 변수로 주입되면 purpose 없이도 안전하게 통과한다', () => {
    const result = resolveLocalPublicEnv(
      {
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_pub_local',
      },
      wranglerProductionText
    )
    assert.equal(result.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:54321')
    assert.equal(result.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'sb_pub_local')
  })

  it('wrangler에 로컬 개발 URL이 적혀 있으면 purpose 없이도 정상 폴백한다', () => {
    const result = resolveLocalPublicEnv({}, wranglerLocalText)
    assert.equal(result.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:54321')
    assert.equal(result.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'sb_publishable_local_fixture')
  })

  it('Cloudflare 빌드 헬퍼(resolveCloudflareBuildEnv)는 purpose: cloudflare-build를 명시하여 설정을 주입한다', () => {
    assert.equal(typeof resolveCloudflareBuildEnv, 'function')
    const buildEnv = resolveCloudflareBuildEnv(
      { EXISTING_VAR: 'preserved' },
      wranglerProductionText,
      'commit_sha_12345'
    )
    assert.equal(buildEnv.EXISTING_VAR, 'preserved')
    assert.equal(buildEnv.NEXT_PUBLIC_SUPABASE_URL, 'https://your-project-ref.supabase.co')
    assert.equal(buildEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'sb_publishable_fixture')
    assert.equal(buildEnv.NEXT_PUBLIC_SOHEE_BUILD_SHA, 'commit_sha_12345')
  })

  it('브라우저 빌드가 런타임 환경 변수에 의존하면 거부한다', () => {
    assert.equal(typeof verifyBuiltClientPublicEnv, 'function')
    assert.throws(
      () =>
        verifyBuiltClientPublicEnv(
          ['const url = process.env.NEXT_PUBLIC_SUPABASE_URL'],
          {
            NEXT_PUBLIC_SUPABASE_URL: 'https://your-project-ref.supabase.co',
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
          }
        ),
      /Cloudflare client artifact still depends on runtime public environment variables/
    )
  })

  it('브라우저 빌드에 승인된 공개 설정이 포함되면 통과한다', () => {
    assert.doesNotThrow(() =>
      verifyBuiltClientPublicEnv(
        [
          'https://your-project-ref.supabase.co',
          'sb_publishable_fixture',
        ],
        {
          NEXT_PUBLIC_SUPABASE_URL: 'https://your-project-ref.supabase.co',
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
        }
      )
    )
  })
})
