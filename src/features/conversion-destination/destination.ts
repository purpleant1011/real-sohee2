import type { DatasetMode } from '@/lib/dataset/dataset-guard'

export type ConversionDatasetMode = DatasetMode
export type ConversionConfiguration = {
  workspaceId: string
  revision: number
  datasetMode: ConversionDatasetMode
  bookingUrl: string | null
  confirmedAt: string | null
  bookingExpiresAt: string | null
  landing: { slug: string; enabled: boolean; privacyNoticeVersion: string; publicDisclosure: string }
}
export type ConversionDestinationView = {
  kind: 'BOOKING_URL' | 'LANDING' | 'REVIEW_REQUIRED' | 'NOT_CONFIGURED'
  href: string | null
  label: string
  evidenceSource: 'OWNER_CONFIRMATION' | null
  networkVerified: false
  revision: number | null
}
export class DestinationInputError extends Error {
  constructor(public readonly code: string, message: string) { super(message) }
}

/** Syntax/shareability only. Never fetch arbitrary owner-supplied URLs from the server. */
export function validateBookingUrl(value: string): string {
  const raw = value.trim()
  const invalid = () => new DestinationInputError('INVALID_DESTINATION_URL', '고객에게 공유할 수 있는 안전한 예약 주소를 입력해 주세요.')
  if (!raw || raw.length > 2048 || /[\u0000- \u007f]/.test(raw)) throw invalid()
  let url: URL
  try { url = new URL(raw) } catch { throw invalid() }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') ||
      !host.includes('.') || host.includes(':') || /^\d+(?:\.\d+){3}$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|invalid|test|onion)$/.test(host) || host.endsWith('.home.arpa')) throw invalid()
  for (const [key] of url.searchParams) {
    if (/^(?:access_token|token|auth|authorization|api_key|key|sig|signature|email|phone|customer|recipient|code)$/i.test(key) || /^(?:x-amz-|x-goog-)/i.test(key)) throw invalid()
  }
  return url.toString()
}

export function validateCampaignTag(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value)) throw new DestinationInputError('INVALID_CAMPAIGN_TAG', '캠페인 구분값을 확인해 주세요.')
  return value
}
function tagged(url: string, tag: string | undefined): string {
  const result = new URL(url)
  if (tag === undefined) return result.toString()
  for (const key of [...result.searchParams.keys()]) {
    if (key.toLowerCase() === 'campaigntag') result.searchParams.delete(key)
  }
  if (tag) result.searchParams.set('campaignTag', tag)
  return result.toString()
}
function isoTime(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

/** Owner confirmation is labeled separately from HTTP/provider verification. */
export function resolveConversionDestination(config: ConversionConfiguration | null, options: {
  workspaceId: string
  datasetMode: ConversionDatasetMode
  publicOrigin: string
  campaignTag?: string
  now?: Date
}): ConversionDestinationView {
  const tag = validateCampaignTag(options.campaignTag)
  const pending = (kind: 'NOT_CONFIGURED' | 'REVIEW_REQUIRED', label: string): ConversionDestinationView => ({
    kind, href: null, label, evidenceSource: null, networkVerified: false, revision: config?.revision ?? null,
  })
  if (!config) return pending('NOT_CONFIGURED', '고객이 문의할 주소를 먼저 설정해 주세요.')
  if (config.workspaceId !== options.workspaceId) throw new DestinationInputError('WORKSPACE_MISMATCH', 'WORKSPACE_MISMATCH')
  if (config.datasetMode !== options.datasetMode || !Number.isInteger(config.revision) || config.revision < 1) return pending('REVIEW_REQUIRED', '문의 주소를 다시 확인해 주세요.')
  const now = (options.now ?? new Date()).getTime()
  const confirmed = isoTime(config.confirmedAt)
  // A conservative preflight freshness window. It is not a synthetic HTTP-availability claim.
  if (!Number.isFinite(now) || confirmed === null || confirmed > now || now - confirmed > 24 * 60 * 60 * 1000) return pending('REVIEW_REQUIRED', '고객이 도착할 페이지를 다시 확인해 주세요.')
  if (config.bookingUrl !== null) {
    const expiry = isoTime(config.bookingExpiresAt)
    if (config.bookingExpiresAt !== null && (expiry === null || expiry <= now)) return pending('REVIEW_REQUIRED', '예약 주소의 사용 기간을 다시 확인해 주세요.')
    try {
      return { kind: 'BOOKING_URL', href: tagged(validateBookingUrl(config.bookingUrl), tag), label: '사장님이 확인한 예약 링크', evidenceSource: 'OWNER_CONFIRMATION', networkVerified: false, revision: config.revision }
    } catch {
      return pending('REVIEW_REQUIRED', '예약 주소를 다시 확인해 주세요.')
    }
  }
  if (!config.landing.enabled) return pending('NOT_CONFIGURED', '고객이 문의할 주소를 먼저 설정해 주세요.')
  if (!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(config.landing.slug) || !config.landing.privacyNoticeVersion.trim() || !config.landing.publicDisclosure.trim()) return pending('REVIEW_REQUIRED', '문의 페이지와 개인정보 안내를 다시 확인해 주세요.')
  const origin = new URL(validateBookingUrl(options.publicOrigin))
  if (origin.pathname !== '/' || origin.search) throw new DestinationInputError('INVALID_PUBLIC_ORIGIN', '문의 페이지 주소를 확인하지 못했어요.')
  return { kind: 'LANDING', href: tagged(new URL(`/l/${config.landing.slug}`, origin.origin).toString(), tag), label: '가게 문의 페이지', evidenceSource: 'OWNER_CONFIRMATION', networkVerified: false, revision: config.revision }
}
