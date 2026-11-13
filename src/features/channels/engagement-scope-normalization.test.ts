import { describe, expect, it } from 'vitest'
import { normalizeChannelScopes } from '@/features/channels/dual-channel-verification'

describe('engagement scope normalization', () => {
  it('lets legacy and business instagram comment scopes satisfy the send gate', () => {
    expect(normalizeChannelScopes('instagram', ['instagram_business_manage_comments'])).toContain(
      'instagram_manage_comments',
    )
    expect(normalizeChannelScopes('instagram', ['instagram_manage_comments'])).toContain(
      'instagram_business_manage_comments',
    )
  })

  it('lets legacy and business instagram message scopes satisfy the DM gate', () => {
    expect(normalizeChannelScopes('instagram', ['instagram_business_manage_messages'])).toContain(
      'instagram_manage_messages',
    )
  })

  it('does not grant comment scope from unrelated scopes', () => {
    const scopes = normalizeChannelScopes('instagram', ['instagram_business_basic', 'instagram_business_content_publish'])
    expect(scopes).not.toContain('instagram_manage_comments')
    expect(scopes).not.toContain('instagram_business_manage_comments')
  })

  it('keeps threads reply scope exact', () => {
    expect(normalizeChannelScopes('threads', ['threads_manage_replies'])).toContain('threads_manage_replies')
    expect(normalizeChannelScopes('threads', ['threads_basic'])).not.toContain('threads_manage_replies')
  })
})
