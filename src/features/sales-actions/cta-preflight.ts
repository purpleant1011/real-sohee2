import { auditLocalPresence, inspectPublicUrl, type PresenceAuditInput } from '@/features/local-presence/audit'
import type { ConversionDestinationView } from '@/features/conversion-destination/destination'

export type CtaWarning = Readonly<{ code: 'PORTAL_NOT_OBSERVED' | 'PORTAL_MISMATCH' | 'PORTAL_EVIDENCE_INSUFFICIENT' | 'CTA_URL_MISMATCH' | 'PORTAL_AUDIT_UNAVAILABLE'; message: string }>
export type CtaPreflightResult = Readonly<{ status: 'OK' | 'WARN' | 'BLOCK'; warnings: readonly CtaWarning[]; ownerMessage: string }>

function withoutCampaignTag(href: string): string {
  try {
    const url = new URL(href)
    for (const key of [...url.searchParams.keys()]) if (key.toLowerCase() === 'campaigntag') url.searchParams.delete(key)
    return url.toString()
  } catch { return href }
}

const FIELD_LABEL: Record<string, string> = { name: '가게 이름', address: '주소', hours: '영업시간', phone: '전화번호', booking: '예약 링크', inquiry: '문의 링크', cta: '문의·예약 링크' }

/**
 * Pre-publish check of where a CTA sends customers. Blocks an empty/unconfirmed destination;
 * compares owner facts with imported portal/map evidence and only warns on mismatch.
 * Pure: it never fetches a URL, so "consistent" means consistent with the provided evidence only.
 */
export function ctaPreflight(input: { workspaceId: string; destination: ConversionDestinationView | null; presence: PresenceAuditInput | null; now: string }): CtaPreflightResult {
  const { destination, presence } = input
  if (!destination || !destination.href || (destination.kind !== 'BOOKING_URL' && destination.kind !== 'LANDING')) {
    return { status: 'BLOCK', warnings: [], ownerMessage: '고객이 문의할 주소를 먼저 설정하고 확인해 주세요. 빈 링크로는 게시하지 않아요.' }
  }
  const warnings: CtaWarning[] = []
  if (!presence) {
    warnings.push({ code: 'PORTAL_NOT_OBSERVED', message: '검색·지도에 등록된 가게 정보를 아직 확인하지 못했어요. 게시 전에 직접 비교해 보세요.' })
  } else if (presence.workspaceId !== input.workspaceId) {
    warnings.push({ code: 'PORTAL_AUDIT_UNAVAILABLE', message: '다른 가게의 포털 자료라 비교하지 않았어요.' })
  } else {
    try {
      const report = auditLocalPresence({ ...presence, now: input.now })
      const mismatched = report.findings.filter(f => f.state === 'DISCREPANCY').map(f => FIELD_LABEL[f.field] ?? f.field)
      const insufficient = report.findings.some(f => ['STALE', 'NOT_OBSERVED', 'ERROR'].includes(f.state))
      if (mismatched.length) warnings.push({ code: 'PORTAL_MISMATCH', message: `검색·지도 정보와 다른 항목이 있어요: ${[...new Set(mismatched)].join(', ')}. 확인 후 게시해 주세요.` })
      if (insufficient) warnings.push({ code: 'PORTAL_EVIDENCE_INSUFFICIENT', message: '일부 항목은 최근 확인 자료가 없어 일치 여부를 알 수 없어요.' })
      const published = inspectPublicUrl(withoutCampaignTag(destination.href))
      const portalCtas = presence.ctas.map(cta => inspectPublicUrl(cta.expectedUrl)).filter((u): u is NonNullable<typeof u> => u !== null)
      if (published && portalCtas.length > 0 && !portalCtas.some(u => u.canonical === published.canonical)) {
        warnings.push({ code: 'CTA_URL_MISMATCH', message: '검색·지도에 걸려 있는 예약 링크와 이번에 쓰는 링크가 달라요.' })
      }
    } catch {
      warnings.push({ code: 'PORTAL_AUDIT_UNAVAILABLE', message: '검색·지도 정보를 비교하지 못했어요. 게시 전에 직접 확인해 주세요.' })
    }
  }
  return { status: warnings.length ? 'WARN' : 'OK', warnings, ownerMessage: warnings[0]?.message ?? '' }
}
