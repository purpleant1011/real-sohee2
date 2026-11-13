import { describe, expect, it } from 'vitest'
import { buildPublishingHref, formatSuccessRate, parsePublishingSearchParams, summarizePublishOperations } from './publishing-summary'

const s = (displayState: 'pending' | 'publishing' | 'success' | 'failure' | 'unknown') => ({ displayState })

describe('summarizePublishOperations', () => {
  it('counts each bucket and computes success rate over finished items only', () => {
    const r = summarizePublishOperations([s('success'), s('success'), s('success'), s('failure'), s('pending'), s('publishing'), s('unknown')])
    expect(r).toMatchObject({ total: 7, published: 3, inProgress: 2, failed: 1, needsCheck: 1 })
    expect(r.successRate).toBeCloseTo(0.75)
    expect(formatSuccessRate(r.successRate)).toBe('75.0%')
  })
  it('returns null rate when nothing finished or empty', () => {
    expect(summarizePublishOperations([]).successRate).toBeNull()
    expect(summarizePublishOperations([s('pending'), s('unknown')]).successRate).toBeNull()
    expect(formatSuccessRate(null)).toBeNull()
  })
})

describe('parsePublishingSearchParams', () => {
  const id = '10000000-0000-4000-8000-000000000001'
  it('accepts valid values', () => {
    expect(parsePublishingSearchParams({ status: 'failure', workspaceId: id, cursor: 'abc' })).toEqual({ status: 'failure', workspaceId: id, cursor: 'abc' })
  })
  it('drops invalid values', () => {
    expect(parsePublishingSearchParams({ status: 'bogus', workspaceId: 'x' })).toEqual({})
    expect(parsePublishingSearchParams(null)).toEqual({})
  })
  it('builds hrefs', () => {
    expect(buildPublishingHref({})).toBe('/admin/publishing')
    expect(buildPublishingHref({ status: 'success', cursor: 'c' })).toBe('/admin/publishing?status=success&cursor=c')
  })
})
