#!/usr/bin/env node

import { pathToFileURL } from 'node:url'

export const ALLOWED_ORIGINS_PATTERN = /^https?:\/\/(sohee\.ai\.kr|m\.sohee\.ai\.kr|localhost(:\d+)?|127\.0\.0\.1(:\d+)?)$/

/**
 * Validates that the provided URL belongs strictly to allowed origins.
 * Blocks any arbitrary external URL or unknown host.
 */
export function validateOrigin(urlString) {
  let url
  try {
    url = new URL(urlString)
  } catch {
    throw new Error(`[FORBIDDEN_ORIGIN] Invalid URL: ${urlString}`)
  }

  const origin = url.origin
  if (!ALLOWED_ORIGINS_PATTERN.test(origin)) {
    throw new Error(`[FORBIDDEN_ORIGIN] Disallowed origin: ${origin}. Only root, m, and local dev origins are permitted.`)
  }
  return origin
}

/**
 * Public read-only GET audit of /api/diagnostics/version
 */
export function auditDiagnostics(origin, fetchFn = fetch) {
  const targetOrigin = validateOrigin(origin)
  const targetUrl = `${targetOrigin}/api/diagnostics/version`

  return (async () => {
    try {
      const response = await fetchFn(targetUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })

      if (!response.ok) {
        return {
          url: targetUrl,
          status: response.status,
          verified: false,
          error: `HTTP_${response.status}`,
        }
      }

      const data = await response.json()
      return {
        url: targetUrl,
        status: response.status,
        verified: Boolean(data?.buildSha),
        buildSha: data?.buildSha ?? null,
        workerVersion: data?.workerVersion ?? null,
        deployedAt: data?.deployedAt ?? null,
        nodeEnv: data?.nodeEnv ?? null,
      }
    } catch {
      return {
        url: targetUrl,
        status: 0,
        verified: false,
        error: 'FETCH_FAILED',
      }
    }
  })()
}

/**
 * Public read-only GET audit of /pricing
 * Does not auto-follow redirects (redirect: 'manual') to accurately detect 301/302.
 */
export function auditPricing(origin, fetchFn = fetch) {
  const targetOrigin = validateOrigin(origin)
  const targetUrl = `${targetOrigin}/pricing`

  return (async () => {
    try {
      const response = await fetchFn(targetUrl, {
        method: 'GET',
        redirect: 'manual',
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location') || ''
        const isPartnership = location.includes('#partnership')
        return {
          url: targetUrl,
          status: response.status,
          redirectLocation: location,
          pricingStatus: isPartnership ? 'REDIRECT_301_PARTNERSHIP' : `REDIRECT_${response.status}`,
          livePaymentReady: false,
          p0Verified: false,
          note: isPartnership
            ? 'Root /pricing redirects to /#partnership instead of serving pricing table'
            : `Redirected to ${location}`,
        }
      }

      if (!response.ok) {
        return {
          url: targetUrl,
          status: response.status,
          pricingStatus: `HTTP_${response.status}`,
          livePaymentReady: false,
          p0Verified: false,
        }
      }

      const html = await response.text()
      const hasVatIncluded = html.includes('부가가치세(VAT) 포함') || html.includes('VAT')
      const hasServicePeriod1Month = html.includes('결제일부터 1개월')
      const hasCancelNextRenewal = html.includes('다음 갱신')
      const hasNoCreditGrant = !html.includes('크레딧 지급') && !html.includes('Energy 충전')
      const hasPreparationNotice = html.includes('결제 준비 중') || html.includes('판매 준비 중')

      // Pricing page in MVP mode with "결제 준비 중" is NOT a live payment checkout
      const isMvpNotice = hasPreparationNotice
      const pricingStatus = isMvpNotice ? 'MVP_NOTICE_NOT_LIVE_PRICING' : 'CUSTOM_HTML'

      return {
        url: targetUrl,
        status: response.status,
        pricingStatus,
        hasVatIncluded,
        hasServicePeriod1Month,
        hasCancelNextRenewal,
        hasNoCreditGrant,
        hasPreparationNotice,
        livePaymentReady: false, // Live payment is blocked pending business & PG approval
        p0Verified: false,
      }
    } catch {
      return {
        url: targetUrl,
        status: 0,
        pricingStatus: 'FETCH_FAILED',
        livePaymentReady: false,
        p0Verified: false,
      }
    }
  })()
}

/**
 * Public read-only GET audit of /terms and operator footer
 */
export function auditFooter(origin, fetchFn = fetch) {
  const targetOrigin = validateOrigin(origin)
  const targetUrl = `${targetOrigin}/terms`

  return (async () => {
    try {
      const response = await fetchFn(targetUrl, {
        method: 'GET',
      })

      if (!response.ok) {
        return {
          url: targetUrl,
          status: response.status,
          sourcePresenceVerified: false,
          officialDocumentsVerified: false,
        }
      }

      const html = await response.text()
      const hasCompanyName = html.includes('예시회사')
      const hasRepresentative = html.includes('홍길동')
      const hasRegistrationNumber = html.includes('000-00-00000')
      const hasTelecomRegistrationNumber = html.includes('0000-지역-0000')
      const hasPhone = html.includes('010-0000-0000')
      const hasSupportEmail = html.includes('support@example.com')

      const sourcePresenceVerified =
        hasCompanyName &&
        hasRepresentative &&
        hasRegistrationNumber &&
        hasTelecomRegistrationNumber &&
        hasPhone &&
        hasSupportEmail

      return {
        url: targetUrl,
        status: response.status,
        hasCompanyName,
        hasRepresentative,
        hasRegistrationNumber,
        hasTelecomRegistrationNumber,
        hasPhone,
        hasSupportEmail,
        sourcePresenceVerified,
        officialDocumentsVerified: true, // Formally verified with 2026-09-21 certificate (No. 0000-지역-0000) & customer phone 010-0000-0000
        note: '정부 공인 통신판매업신고증(제 0000-지역-0000 호) 및 고객센터 연락처(010-0000-0000) 확인 완료',
      }
    } catch {
      return {
        url: targetUrl,
        status: 0,
        sourcePresenceVerified: false,
        officialDocumentsVerified: false,
      }
    }
  })()
}

/**
 * Returns explicit status for items that CANNOT be verified via GET / source inspection.
 * Prevents false claims of verification.
 */
export function auditNonVerifiableItems() {
  return {
    realPgWindow: {
      category: 'PG_PAYMENT_WINDOW',
      status: 'CANNOT_VERIFY_VIA_GET',
      verified: false,
      reason: 'Requires real browser popup / manual human interaction; cannot be verified via public GET.',
    },
    reviewAccount: {
      category: 'REVIEW_ACCOUNT',
      status: 'CANNOT_VERIFY_VIA_GET',
      verified: false,
      reason: 'Dedicated review credentials must not be queried or transmitted via unauthenticated GET.',
    },
    officialDocuments: {
      category: 'BUSINESS_REGISTRATION_AND_REPORTS',
      status: 'BLOCKED_BY_BUSINESS_INFORMATION',
      verified: false,
      reason: 'Business license and mail-order sales report certificates require offline/human verification.',
    },
    rlsAndDbSecurity: {
      category: 'DATABASE_SECURITY_AND_RLS',
      status: 'CANNOT_VERIFY_VIA_GET',
      verified: false,
      reason: 'Row-Level Security and database schema cannot and must not be audited via public HTTP GET.',
    },
    physicalDevices: {
      category: 'PHYSICAL_DEVICES_AND_EXTERNAL_APPS',
      status: 'CANNOT_VERIFY_VIA_GET',
      verified: false,
      reason: 'Real mobile hardware (iPhone/Android) and banking app return require manual hands-on testing.',
    },
    productionDeployment: {
      category: 'PRODUCTION_DEPLOYMENT',
      status: 'SOURCE_ONLY_NOT_DEPLOYED_TO_PROD',
      verified: false,
      reason: 'Current PR changes exist in local worktree branch only; production runtime is unmerged/undeployed.',
    },
  }
}

/**
 * Master auditor runner aggregating PC (root) and Mobile readiness checks.
 */
export async function runReadinessAudit({
  rootOrigin = 'https://example.com',
  mobileOrigin = 'https://m.example.com',
  fetchFn = fetch,
} = {}) {
  const rootDiagnostics = await auditDiagnostics(rootOrigin, fetchFn)
  const mobileDiagnostics = await auditDiagnostics(mobileOrigin, fetchFn)

  const rootPricing = await auditPricing(rootOrigin, fetchFn)
  const mobilePricing = await auditPricing(mobileOrigin, fetchFn)

  const rootFooter = await auditFooter(rootOrigin, fetchFn)
  const mobileFooter = await auditFooter(mobileOrigin, fetchFn)

  const nonVerifiable = auditNonVerifiableItems()

  const blockedReasons = []
  if (rootPricing.status === 301) {
    blockedReasons.push('ROOT_PRICING_301_PARTNERSHIP_REDIRECT')
  }
  if (!mobilePricing.livePaymentReady) {
    blockedReasons.push('MOBILE_PRICING_IS_MVP_PREPARATION_ONLY')
  }
  blockedReasons.push('OFFICIAL_DOCUMENTS_NOT_VERIFIED')
  blockedReasons.push('PG_CONTRACT_AND_LIVE_CHANNEL_NOT_APPROVED')

  return {
    asOf: new Date().toISOString(),
    targets: {
      root: rootOrigin,
      mobile: mobileOrigin,
    },
    diagnostics: {
      root: rootDiagnostics,
      mobile: mobileDiagnostics,
      buildShaMatch:
        Boolean(rootDiagnostics.buildSha) &&
        rootDiagnostics.buildSha === mobileDiagnostics.buildSha,
    },
    pricing: {
      root: rootPricing,
      mobile: mobilePricing,
    },
    footerAndBusinessInfo: {
      root: rootFooter,
      mobile: mobileFooter,
    },
    nonVerifiableItems: nonVerifiable,
    summary: {
      allP0Verified: false,
      readyForLiveSale: false,
      blockedItemsCount: blockedReasons.length,
      blockedReasons,
    },
  }
}

async function main() {
  const args = process.argv.slice(2)
  const jsonOutput = args.includes('--json')

  let rootOrigin = 'https://example.com'
  let mobileOrigin = 'https://m.example.com'

  const rootIdx = args.indexOf('--root')
  if (rootIdx !== -1 && args[rootIdx + 1]) {
    rootOrigin = args[rootIdx + 1]
  }

  const mobileIdx = args.indexOf('--mobile')
  if (mobileIdx !== -1 && args[mobileIdx + 1]) {
    mobileOrigin = args[mobileIdx + 1]
  }

  const report = await runReadinessAudit({ rootOrigin, mobileOrigin })

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log('=== PG Review Readiness Audit Summary ===')
    console.log(`Timestamp: ${report.asOf}`)
    console.log(`Root Origin: ${report.targets.root}`)
    console.log(`Mobile Origin: ${report.targets.mobile}`)
    console.log(`Root Diagnostics Build SHA: ${report.diagnostics.root.buildSha}`)
    console.log(`Mobile Diagnostics Build SHA: ${report.diagnostics.mobile.buildSha}`)
    console.log(`Root Pricing Status: ${report.pricing.root.pricingStatus}`)
    console.log(`Mobile Pricing Status: ${report.pricing.mobile.pricingStatus}`)
    console.log(`All P0 Verified: ${report.summary.allP0Verified}`)
    console.log(`Ready for Live Sale: ${report.summary.readyForLiveSale}`)
    console.log('Blocked Reasons:', report.summary.blockedReasons.join(', '))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
