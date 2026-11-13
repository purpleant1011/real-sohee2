import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateOrigin,
  auditDiagnostics,
  auditPricing,
  auditFooter,
  auditNonVerifiableItems,
  runReadinessAudit,
} from './verify-pg-review-readiness.mjs'

describe('verify-pg-review-readiness CLI & auditor', () => {
  describe('Origin Allowlist & URL Safety', () => {
    it('허용된 root/m 및 localhost/127.0.0.1 origin을 정상 승인한다', () => {
      assert.equal(validateOrigin('https://example.com'), 'https://example.com')
      assert.equal(validateOrigin('https://m.example.com'), 'https://m.example.com')
      assert.equal(validateOrigin('http://localhost:3000'), 'http://localhost:3000')
      assert.equal(validateOrigin('http://127.0.0.1:8788'), 'http://127.0.0.1:8788')
    })

    it('외부 임의 도메인은 fail-closed로 거부한다', () => {
      assert.throws(
        () => validateOrigin('https://attacker.com'),
        /FORBIDDEN_ORIGIN/
      )
      assert.throws(
        () => validateOrigin('https://api.portone.io'),
        /FORBIDDEN_ORIGIN/
      )
    })
  })

  describe('Diagnostics Audit', () => {
    it('200 diagnostics 응답에서 buildSha와 workerVersion을 추출하고 비밀값은 노출하지 않는다', async () => {
      const mockFetch = async (url) => {
        assert(url.includes('/api/diagnostics/version'))
        return {
          status: 200,
          ok: true,
          json: async () => ({
            buildSha: 'f58c475',
            workerVersion: 'v0.9.0-prod',
            deployedAt: '2026-11-06T12:00:00.000Z',
            nodeEnv: 'production',
          }),
        }
      }

      const result = await auditDiagnostics('https://m.example.com', mockFetch)
      assert.equal(result.status, 200)
      assert.equal(result.buildSha, 'f58c475')
      assert.equal(result.workerVersion, 'v0.9.0-prod')
      assert.equal(result.verified, true)
    })

    it('diagnostics 실패 시 NOT_VERIFIED를 반환한다', async () => {
      const mockFetch = async () => {
        throw new Error('connection refused')
      }

      const result = await auditDiagnostics('https://m.example.com', mockFetch)
      assert.equal(result.status, 0)
      assert.equal(result.verified, false)
      assert.equal(result.error, 'FETCH_FAILED')
    })
  })

  describe('Pricing Audit & Latest Policy Checks', () => {
    it('Root 도메인의 301 #partnership 리다이렉트를 NOT_VERIFIED 및 MISSING으로 판정한다', async () => {
      const mockFetch = async (url, options) => {
        assert.equal(options?.redirect, 'manual')
        return {
          status: 301,
          ok: false,
          headers: new Headers({
            location: 'https://example.com/#partnership',
          }),
          text: async () => '',
        }
      }

      const result = await auditPricing('https://example.com', mockFetch)
      assert.equal(result.status, 301)
      assert.equal(result.redirectLocation, 'https://example.com/#partnership')
      assert.equal(result.pricingStatus, 'REDIRECT_301_PARTNERSHIP')
      assert.equal(result.livePaymentReady, false)
      assert.equal(result.p0Verified, false)
    })

    it('Mobile 도메인의 200 요금 안내에서 최신 정책(VAT포함, 1개월제공, 다음갱신해지, 크레딧없음)과 MVP 준비중 문구를 확인한다', async () => {
      const mockHtml = `
        <html>
          <body>
            <div>월 구독 요금 안내 · 판매 준비 중</div>
            <div>부가가치세(VAT) 포함</div>
            <div>서비스 제공기간: 결제일부터 1개월</div>
            <div>해지 기준: 다음 갱신부터 해지</div>
            <div>월 구독에 크레딧을 지급하지 않습니다</div>
            <div>결제 준비 중</div>
          </body>
        </html>
      `
      const mockFetch = async () => ({
        status: 200,
        ok: true,
        headers: new Headers({
          'content-type': 'text/html',
          'x-sohee-build': 'f58c475',
        }),
        text: async () => mockHtml,
      })

      const result = await auditPricing('https://m.example.com', mockFetch)
      assert.equal(result.status, 200)
      assert.equal(result.hasVatIncluded, true)
      assert.equal(result.hasServicePeriod1Month, true)
      assert.equal(result.hasCancelNextRenewal, true)
      assert.equal(result.hasNoCreditGrant, true)
      assert.equal(result.hasPreparationNotice, true)
      // 결제 준비 중인 MVP 안내이므로 실제 결제 가능 상태(livePaymentReady)는 false여야 함
      assert.equal(result.pricingStatus, 'MVP_NOTICE_NOT_LIVE_PRICING')
      assert.equal(result.livePaymentReady, false)
      assert.equal(result.p0Verified, false)
    })
  })

  describe('Footer & Operator Info Audit', () => {
    it('필수 사업자 정보(예시회사, 홍길동, 사업자번호, 통신판매번호, 전화번호, 이메일) presence를 검증한다', async () => {
      const mockHtml = `
        <footer>
          <span>예시회사</span>
          <span>대표: 홍길동</span>
          <span>사업자등록번호: 000-00-00000</span>
          <span>통신판매업신고번호: 제 0000-지역-0000 호</span>
          <span>고객센터: 010-0000-0000</span>
          <span>support@example.com</span>
        </footer>
      `
      const mockFetch = async () => ({
        status: 200,
        ok: true,
        headers: new Headers(),
        text: async () => mockHtml,
      })

      const result = await auditFooter('https://m.example.com', mockFetch)
      assert.equal(result.hasCompanyName, true)
      assert.equal(result.hasRepresentative, true)
      assert.equal(result.hasRegistrationNumber, true)
      assert.equal(result.hasTelecomRegistrationNumber, true)
      assert.equal(result.hasPhone, true)
      assert.equal(result.hasSupportEmail, true)
      assert.equal(result.sourcePresenceVerified, true)
      assert.equal(result.officialDocumentsVerified, true)
    })
  })

  describe('Non-Verifiable Items from GET/Source only', () => {
    it('실제 PG 결제창, 계정, 서류, RLS, 실기기, 운영배포는 GET만으로 절대 VERIFIED 승격하지 않는다', () => {
      const nonVerifiable = auditNonVerifiableItems()
      assert.equal(nonVerifiable.realPgWindow.status, 'CANNOT_VERIFY_VIA_GET')
      assert.equal(nonVerifiable.reviewAccount.status, 'CANNOT_VERIFY_VIA_GET')
      assert.equal(nonVerifiable.officialDocuments.status, 'BLOCKED_BY_BUSINESS_INFORMATION')
      assert.equal(nonVerifiable.rlsAndDbSecurity.status, 'CANNOT_VERIFY_VIA_GET')
      assert.equal(nonVerifiable.physicalDevices.status, 'CANNOT_VERIFY_VIA_GET')
      assert.equal(nonVerifiable.productionDeployment.status, 'SOURCE_ONLY_NOT_DEPLOYED_TO_PROD')

      // 어떤 항목도 VERIFIED가 아니어야 함
      for (const [key, item] of Object.entries(nonVerifiable)) {
        assert.notEqual(item.status, 'VERIFIED', `${key} should not be VERIFIED`)
        assert.equal(item.verified, false, `${key} verified must be false`)
      }
    })
  })

  describe('End-to-End Auditor Runner', () => {
    it('전체 audit 결과 JSON에 민감한 키/토큰/비밀/개인정보가 전혀 포함되지 않는다', async () => {
      const mockFetch = async (url) => {
        if (url.includes('/api/diagnostics/version')) {
          return {
            status: 200,
            ok: true,
            json: async () => ({
              buildSha: 'f58c475',
              workerVersion: 'v0.9.0-prod',
              deployedAt: '2026-11-06T12:00:00.000Z',
              nodeEnv: 'production',
            }),
          }
        }
        if (url.includes('example.com/pricing') && !url.includes('m.example.com')) {
          return {
            status: 301,
            ok: false,
            headers: new Headers({ location: 'https://example.com/#partnership' }),
            text: async () => '',
          }
        }
        return {
          status: 200,
          ok: true,
          headers: new Headers(),
          text: async () => '예시회사 홍길동 000-00-00000 support@example.com 부가가치세(VAT) 포함 결제일부터 1개월 다음 갱신 결제 준비 중',
        }
      }

      const report = await runReadinessAudit({
        rootOrigin: 'https://example.com',
        mobileOrigin: 'https://m.example.com',
        fetchFn: mockFetch,
      })

      const reportJson = JSON.stringify(report)
      assert(!reportJson.includes('secret'))
      assert(!reportJson.includes('PORTONE_API_SECRET'))
      assert(!reportJson.includes('password'))
      assert(!reportJson.includes('token='))
      assert.equal(report.summary.allP0Verified, false)
      assert.equal(report.summary.blockedItemsCount > 0, true)
    })
  })
})
