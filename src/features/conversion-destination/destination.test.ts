import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConversionDestination, validateBookingUrl, type ConversionConfiguration } from './destination'

const now = new Date('2026-10-22T00:00:00Z')
const config: ConversionConfiguration = {
  workspaceId: 'workspace-a', revision: 1, datasetMode: 'TEST',
  bookingUrl: 'https://booking.example.com/shop-a?service=1',
  confirmedAt: '2026-10-21T23:30:00Z', bookingExpiresAt: null,
  landing: { slug: 'shop-a', enabled: true, privacyNoticeVersion: 'notice-1', publicDisclosure: '문의 정보는 답변을 위해 가게에 전달됩니다.' },
}
const options = { workspaceId: 'workspace-a', publicOrigin: 'https://example.com', campaignTag: 'campaign_a', datasetMode: 'TEST' as const, now }
afterEach(() => vi.unstubAllGlobals())

describe('owner-confirmed booking link and inquiry destination', () => {
  it('prefers the existing booking link without changing its shop path or claiming a network verification', () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const result = resolveConversionDestination(config, options)
    expect(result.kind).toBe('BOOKING_URL')
    const link = new URL(result.href!)
    expect(link.origin).toBe('https://booking.example.com')
    expect(link.pathname).toBe('/shop-a')
    expect(link.searchParams.get('service')).toBe('1')
    expect(link.searchParams.get('campaignTag')).toBe('campaign_a')
    expect(result.evidenceSource).toBe('OWNER_CONFIRMATION')
    expect(result.networkVerified).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('preserves an existing campaign parameter when no replacement is requested', () => {
    const bookingUrl = 'https://booking.example.com/shop-a?campaignTag=original&service=1'
    const result = resolveConversionDestination({ ...config, bookingUrl }, { ...options, campaignTag: undefined })
    expect(result.href).toBe(bookingUrl)
  })

  it('does not duplicate a campaign tag on an already tagged destination', () => {
    const result = resolveConversionDestination({ ...config, bookingUrl: 'https://booking.example.com/shop-a?campaignTag=old&CampaignTag=older' }, options)
    expect([...new URL(result.href!).searchParams].filter(([key]) => key.toLowerCase() === 'campaigntag')).toEqual([['campaignTag', 'campaign_a']])
  })

  it('uses the workspace landing only when there is no booking URL and its public/consent contract is ready', () => {
    const result = resolveConversionDestination({ ...config, bookingUrl: null }, options)
    expect(result.kind).toBe('LANDING')
    expect(result.href).toBe('https://example.com/l/shop-a?campaignTag=campaign_a')
  })

  it.each([
    { ...config, confirmedAt: null },
    { ...config, confirmedAt: '2026-10-20T00:00:00Z' },
    { ...config, bookingExpiresAt: '2026-10-21T23:59:59Z' },
    { ...config, bookingUrl: 'javascript:alert(1)' },
    { ...config, bookingUrl: null, landing: { ...config.landing, privacyNoticeVersion: '' } },
  ])('does not quietly fall back or claim a ready destination for stale/invalid evidence: %j', (value) => {
    expect(resolveConversionDestination(value, options)).toMatchObject({ kind: 'REVIEW_REQUIRED', href: null, networkVerified: false })
  })

  it('fails closed on a non-ACTUAL configuration in ACTUAL mode', () => {
    expect(resolveConversionDestination(config, { ...options, datasetMode: 'ACTUAL' })).toMatchObject({ kind: 'REVIEW_REQUIRED', href: null })
  })

  it('rejects a cross-workspace configuration instead of returning another shop link', () => {
    expect(() => resolveConversionDestination({ ...config, workspaceId: 'workspace-b' }, options)).toThrow('WORKSPACE_MISMATCH')
  })

  it('distinguishes no configured destination from a reviewed destination', () => {
    expect(resolveConversionDestination(null, options)).toMatchObject({ kind: 'NOT_CONFIGURED', href: null, evidenceSource: null })
  })

  it.each([
    'http://booking.example.com/shop-a', 'javascript:alert(1)', 'file:///private/a',
    'https://owner:password@booking.example.com/shop-a', 'https://localhost/a',
    'https://127.0.0.1/a', 'https://2130706433/a', 'https://[::1]/a',
    'https://shop.internal/a', 'https://shop.local/a',
    'https://booking.example.com/a?access_token=private', 'https://booking.example.com/a#private-token',
  ])('rejects unsafe or non-shareable booking URLs: %s', (url) => {
    expect(() => validateBookingUrl(url)).toThrow()
  })

  it.each(['owner@example.com', '+821012345678', 'campaign with spaces', '../other-shop'])('rejects raw contact data and path-like campaign tags: %s', (campaignTag) => {
    expect(() => resolveConversionDestination(config, { ...options, campaignTag })).toThrow()
  })
})
