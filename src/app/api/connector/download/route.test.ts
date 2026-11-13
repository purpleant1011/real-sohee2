import { describe, expect, it } from 'vitest'
import { GET } from './route'

describe('GET /api/connector/download', () => {
  it('returns binary zip response with attachment disposition', async () => {
    // V1.2 G0-02: 네이버 외부 자동화 단일 정책 정본에 따라 네이버 연결기 확장 ZIP 배포 중단 (403 POLICY_DISABLED)
    const response = await GET(new Request('http://localhost/api/connector/download'))

    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.errorCode).toBe('POLICY_DISABLED')
    expect(json.action).toBe('publish')
  })
})
