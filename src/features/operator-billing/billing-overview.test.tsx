import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import BillingOverview from './billing-overview'

describe('BillingOverview', () => {
  it('shows honest read states without payment secrets or sample revenue', () => {
    const html = renderToStaticMarkup(<BillingOverview data={{
      items: [],
      summary: { state: 'empty', workspaceCount: null, sourceTimestamp: '2026-08-23T03:00:00.000Z' },
    }} />)
    expect(html).toContain('실제 사업자 고객사')
    expect(html).toContain('무료 체험')
    expect(html).toContain('ant-pro-table')
    expect(html).not.toMatch(/provider_reference|idempotency_key|secret|password|12,800,000|9,088,700/)
  })

  it('renders customer reference code and Korean copy without exposing full UUID or SC unit', () => {
    const fullUuid = 'efeaa66a-a9e7-4bdd-967d-28988d419bba'
    const html = renderToStaticMarkup(<BillingOverview data={{
      items: [{
        workspace_id: fullUuid,
        workspace_name: '성수 베이커리',
        entitlement: {
          state: 'fresh',
          plan_code: 'starter',
          policy_version: null,
          weekly_limit: null,
          effective_from: null,
          effective_until: null,
          source_timestamp: null,
        },
        balance: {
          state: 'fresh',
          version: 1,
          period_start: null,
          period_end: null,
          granted: null,
          adjustments: null,
          released: null,
          consumed: null,
          reserved: null,
          available: 1200,
          source_timestamp: null,
        },
        payment: {
          state: 'fresh',
          latest_state: 'provider_succeeded',
          provider_reference_present: true,
          updated_at: null,
        },
        usage: { state: 'fresh', usage_event_count: null, computed_credits: null, actual_usage_count: null, estimated_usage_count: null, source_timestamp: null },
        cost: { state: 'empty', api_cost_krw: null, reason: 'NOT_MEASURED' },
        freshness: { state: 'fresh', source_timestamp: null },
      }],
      summary: { state: 'fresh', workspaceCount: 1, sourceTimestamp: '2026-08-23T03:00:00.000Z' },
    }} />)

    // UUID 전체 비노출 단언
    expect(html).not.toContain(fullUuid)
    expect(html).toContain('참조번호 efeaa66a')
    expect(html).toContain('성수 베이커리')
    expect(html).toContain('1,200 크레딧')
    expect(html).not.toMatch(/\bSC\b/)
    expect(html).toContain('확인 상태')
    expect(html).toContain('계산한 값')
    expect(html).toContain('결제 완료')
    expect(html).toContain('스타터')
  })

  it('excludes unverified applicant signups from official business metrics without demo label', () => {
    const html = renderToStaticMarkup(<BillingOverview data={{
      items: [
        {
          workspace_id: '11111111-1111-4111-8111-111111111111',
          workspace_name: '정회원 카페',
          member_status: 'FORMAL',
          entitlement: { plan_code: 'growth', state: 'fresh' },
          payment: { latest_state: 'provider_succeeded' },
        },
        {
          workspace_id: '22222222-2222-4222-8222-222222222222',
          workspace_name: '미인증 가입자',
          member_status: 'APPLICANT',
          entitlement: { plan_code: 'starter', state: 'fresh' },
          payment: { latest_state: null },
        },
      ],
      summary: { state: 'fresh', workspaceCount: 1, sourceTimestamp: null },
      applicantCount: 5,
    }} />)

    expect(html).toContain('1개사')
    expect(html).toContain('정회원 기준 · 가입자(미인증) 5곳은 제외')
    expect(html).not.toContain('데모')
  })

  it('correctly counts 9 formal member items even when only 1 is on a paid plan', () => {
    const items = [
      {
        workspace_id: '10000000-0000-4000-8000-000000000001',
        workspace_name: '유료 정회원사',
        entitlement: { plan_code: 'growth', state: 'fresh' },
        payment: { latest_state: 'provider_succeeded' },
        isFormal: true,
      },
      ...Array.from({ length: 8 }, (_, i) => ({
        workspace_id: `10000000-0000-4000-8000-00000000000${i + 2}`,
        workspace_name: `인증 정회원사 ${i + 1}`,
        entitlement: { plan_code: 'starter', state: 'fresh' },
        payment: { latest_state: null },
        isFormal: true,
      })),
    ]

    const html = renderToStaticMarkup(<BillingOverview data={{
      items,
      summary: { state: 'fresh', workspaceCount: 9, sourceTimestamp: null },
      applicantCount: 3,
    }} />)

    expect(html).toContain('9개사')
    expect(html).toContain('1개사')
    expect(html).toContain('8개사')
    expect(html).toContain('정회원 기준 · 가입자(미인증) 3곳은 제외')
  })
})
