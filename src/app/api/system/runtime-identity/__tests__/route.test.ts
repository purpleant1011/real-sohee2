import { afterEach, describe, it, expect, vi } from 'vitest'
import { GET } from '../route'

// ANI-1753: GET() 은 인자 없는 호출에서 probeRemote=true 로 스키마 프로브를 실제 수행한다.
// 예전에는 운영 Supabase 로 나가 우연히 통과했지만, 이제 테스트 URL 은 loopback 이고
// 실제 네트워크 호출은 금지된다. 프로브 응답을 결정적으로 대역해 계약을 그대로 검증한다.
function stubSchemaProbe() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  )
}

describe('GET /api/system/runtime-identity (ANI-989)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns valid JSON identity with all canonical fields and no secrets', async () => {
    stubSchemaProbe()
    const response = await GET()
    expect(response.status).toBe(200)

    const data = await response.json()

    // Required fields per ANI-989
    expect(data).toHaveProperty('appVersion')
    expect(data).toHaveProperty('gitSha')
    expect(data).toHaveProperty('buildTimestamp')
    expect(data).toHaveProperty('environment')
    expect(data).toHaveProperty('datasetMode')
    expect(data).toHaveProperty('expectedMigrationHead')
    expect(data).toHaveProperty('actualMigrationHead')
    expect(data).toHaveProperty('schemaContractHash')
    expect(data).toHaveProperty('ready')
    expect(data).toHaveProperty('readinessStatus')
    expect(data).toHaveProperty('missingTables')
    expect(data).toHaveProperty('checkedAt')

    // Secret Leak Protection
    const jsonString = JSON.stringify(data)
    expect(jsonString).not.toContain('sb_secret')
    expect(jsonString).not.toContain('sk-')
    expect(jsonString).not.toContain('secret')
    expect(jsonString).not.toContain('token')
  })
})
