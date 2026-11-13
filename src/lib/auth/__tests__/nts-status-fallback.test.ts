import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryNtsBusinessValidation } from '../business-verification'

const fetchMock = vi.fn()

function ok(item: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => ({ status_code: 'OK', data: [item] }) }
}

beforeEach(() => {
  process.env.NTS_API_KEY = 'test-key'
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  delete process.env.NTS_API_KEY
})

describe('queryNtsBusinessValidation — 신원 일치 없는 자동 인증 금지', () => {
  it('개업일자 없이 /status 만 정상이면 VERIFIED 가 아니라 PENDING_REVIEW', async () => {
    fetchMock.mockResolvedValue(ok({ b_no: '1234567890', b_stt: '계속사업자', b_stt_cd: '01' }))
    const result = await queryNtsBusinessValidation({ b_no: '1234567890', p_nm: '김소희', b_nm: '모모 카페' })
    expect(result.status).toBe('PENDING_REVIEW')
  })

  it('/validate 가 일치하지 않으면 /status 가 정상이어도 PENDING_REVIEW', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/validate')
        ? ok({ b_no: '1234567890', valid: '02' })
        : ok({ b_no: '1234567890', b_stt: '계속사업자', b_stt_cd: '01' }),
    )
    const result = await queryNtsBusinessValidation({ b_no: '1234567890', p_nm: '김소희', b_nm: '모모 카페', start_dt: '20240101' })
    expect(result.status).toBe('PENDING_REVIEW')
  })

  it('/validate 가 번호·대표자·개업일자 일치(valid=01)를 확인하면 VERIFIED', async () => {
    fetchMock.mockResolvedValue(ok({ b_no: '1234567890', valid: '01', status: { b_stt: '계속사업자', b_stt_cd: '01' } }))
    const result = await queryNtsBusinessValidation({ b_no: '1234567890', p_nm: '김소희', b_nm: '모모 카페', start_dt: '20240101' })
    expect(result.status).toBe('VERIFIED')
  })

  it('폐업자는 /status 로도 CLOSED_BUSINESS', async () => {
    fetchMock.mockResolvedValue(ok({ b_no: '1234567890', b_stt: '폐업자', b_stt_cd: '03' }))
    const result = await queryNtsBusinessValidation({ b_no: '1234567890', p_nm: '김소희', b_nm: '모모 카페' })
    expect(result.status).toBe('CLOSED_BUSINESS')
  })
})
