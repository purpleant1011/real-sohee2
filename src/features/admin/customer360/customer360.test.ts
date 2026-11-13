import { describe, expect, it } from 'vitest'
import { maskDeep, maskEmail, maskName, maskPhone, maskText } from './mask'
import { buildCustomer360Timeline } from './timeline'

const WS = 'a0000000-0000-4000-8000-000000000001'
const OTHER = 'a0000000-0000-4000-8000-000000000002'
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl'

function fakeDb(tables: Record<string, any[] | 'error'>) {
  return {
    from(table: string) {
      let column = 'workspace_id'
      let value = ''
      const q: any = {
        select: () => q,
        eq: (c: string, v: string) => { column = c; value = v; return q },
        then: (res: any, rej: any) => {
          const t = tables[table]
          const answer = t === 'error' ? { data: null, error: { code: 'X' } }
            : { data: (t ?? []).filter(r => r[column] === value), error: null }
          return Promise.resolve(answer).then(res, rej)
        },
      }
      return q
    },
  }
}

describe('masking', () => {
  it('masks personal data', () => {
    expect(maskEmail('owner@example.com')).toBe('o***@example.com')
    expect(maskPhone('010-1234-5678')).toBe('010-****-5678')
    expect(maskName('김철수')).toBe('김*수')
  })
  it('removes tokens, JWTs, signed URLs, secret keys', () => {
    const out = JSON.stringify(maskDeep({
      access_token: 'abc', note: `Bearer abc.def.ghi ${JWT} https://x.test/a?token=zzz&b=1 sk-live1234567890 owner@example.com 010-1234-5678`,
      nested: { api_key: 'k', exact_payload: { a: 1 }, ok: '정상' },
    }))
    for (const leak of ['abc.def', JWT, 'zzz', 'sk-live1234567890', 'owner@example.com', '1234-5678', '"abc"']) expect(out).not.toContain(leak)
    expect(out).toContain('정상')
    expect(maskText(maskText(`Bearer ${JWT}`))).toBe(maskText(`Bearer ${JWT}`))
  })
})

describe('timeline', () => {
  const data = {
    workspaces: [{ id: WS, created_at: '2026-10-01T00:00:00Z' }, { id: OTHER, created_at: '2026-10-01T00:00:00Z' }],
    vault_items: [{ id: 'i1', workspace_id: WS, content_id: 'c1', channel: 'instagram' }, { id: 'i9', workspace_id: OTHER, content_id: 'c9' }],
    vault_events: [
      { id: 'e1', workspace_id: WS, vault_item_id: 'i1', event_type: 'vault.saved', payload: { token: 'secret', phone: '01012345678' }, occurred_at: '2026-10-02T00:00:00Z' },
      { id: 'e9', workspace_id: OTHER, vault_item_id: 'i9', event_type: 'vault.saved', payload: {}, occurred_at: '2026-10-02T00:00:00Z' },
    ],
    preflight_runs: [{ id: 'p1', workspace_id: WS, vault_item_id: 'i1', run_at: '2026-10-03T00:00:00Z', overall: 'FAIL', items: [{ status: 'FAIL', message: '이미지 사용권이 만료되었습니다' }, { status: 'PASS', message: '문구 정상' }] }],
  }

  it('orders signup -> vault -> failed preflight with reason, scoped to the workspace', async () => {
    const t = await buildCustomer360Timeline(fakeDb(data), WS)
    expect(t.events.map(e => e.canonicalId)).toEqual([`workspace:${WS}`, 'vault_event:e1', 'preflight_run:p1'])
    const pre = t.events.at(-1)!
    expect(pre.outcome).toBe('fail')
    expect(pre.detail).toContain('이미지 사용권이 만료되었습니다')
    expect(JSON.stringify(t)).not.toContain('i9')
    expect(JSON.stringify(t)).not.toContain('secret')
    expect(JSON.stringify(t)).not.toContain('01012345678')
    const chain = t.chains.find(c => c.title.includes('vault_item:i1'))!
    expect(chain.steps.map(s => s.href !== null)).toEqual([true, true, false, false])
    expect(chain.steps[2].label).toContain('연결 전')
    expect(chain.verdict).toContain('재검사 실패')
  })

  it('distinguishes a failed source from an empty one, and marks inquiries as not connected', async () => {
    const t = await buildCustomer360Timeline(fakeDb({ ...data, preflight_runs: 'error' }), WS)
    const by = Object.fromEntries(t.sources.map(s => [s.source, s]))
    expect(by.preflight.status).toBe('error')
    expect(by.onboarding.status).toBe('ok')
    expect(by.onboarding.count).toBe(0)
    expect(by.inquiries.status).toBe('not_connected')
  })

  it('PostgREST 1000행 절단 시 소스를 ok/0건으로 위장하지 않고 truncated(절단됨) 상태로 보고한다', async () => {
    const thousandRows = Array.from({ length: 1000 }, (_, i) => ({
      id: `p${i}`,
      workspace_id: WS,
      vault_item_id: 'i1',
      run_at: '2026-10-03T00:00:00Z',
      overall: 'PASS',
      items: [],
    }))
    const t = await buildCustomer360Timeline(fakeDb({ ...data, preflight_runs: thousandRows }), WS)
    const by = Object.fromEntries(t.sources.map(s => [s.source, s]))
    expect(by.preflight.status).toBe('truncated')
    expect(by.preflight.message).toContain('절단')
  })
})
