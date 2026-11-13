import { describe, expect, it, vi } from 'vitest'
import type { ServerSupabaseClient } from '@/features/operations/types'

vi.mock('server-only', () => ({}))

import { BYREUM_IMAGE_HARNESS } from './byreum-image-harness'
import {
  BYREUM_IMAGE_HARNESS_RULE_KEY,
  isByreumTestAccount,
  loadActiveByreumImageHarness,
} from './byreum-image-harness-repository'

describe('isByreumTestAccount', () => {
  it('limits automatic knowledge bootstrap to the designated test account', () => {
    expect(isByreumTestAccount(' TEST@SOHEE.AI.KR ')).toBe(true)
    expect(isByreumTestAccount('owner@example.com')).toBe(false)
    expect(isByreumTestAccount(null)).toBe(false)
  })
})

describe('loadActiveByreumImageHarness', () => {
  it('scopes the active rule by workspace, family, and requested channel', async () => {
    const maybeSingle = vi.fn(async () => ({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        version: 1,
        structured_rule: BYREUM_IMAGE_HARNESS,
      },
      error: null,
    }))
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      contains: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      maybeSingle,
    }
    for (const method of ['select', 'eq', 'contains', 'order', 'limit'] as const) {
      query[method].mockReturnValue(query)
    }
    const client = { from: vi.fn(() => query) } as unknown as ServerSupabaseClient
    const workspaceId = '22222222-2222-4222-8222-222222222222'

    await expect(loadActiveByreumImageHarness({
      client,
      workspaceId,
      channel: 'naver_blog',
    })).resolves.toMatchObject({
      ruleId: '11111111-1111-4111-8111-111111111111',
      harness: { harnessId: 'BYREUM_RECOMMENDED_HARNESS_V1_0' },
    })
    expect(query.eq).toHaveBeenCalledWith('workspace_id', workspaceId)
    expect(query.eq).toHaveBeenCalledWith('rule_key', BYREUM_IMAGE_HARNESS_RULE_KEY)
    expect(query.eq).toHaveBeenCalledWith('status', 'active')
    expect(query.contains).toHaveBeenCalledWith('applies_to_channels', ['naver_blog'])
  })
})
