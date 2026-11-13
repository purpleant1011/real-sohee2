import { describe, expect, it } from 'vitest'
import { channelCapabilities } from './channel-capabilities'

describe('channelCapabilities', () => {
  it.each([
    'instagram',
    'threads',
    'naver_blog',
    'naver_place',
    'daangn_business',
  ] as const)('defines a capability contract for %s', (channel) => {
    expect(channelCapabilities[channel]).toBeDefined()
  })

  it('does not accept an unregistered channel identifier', () => {
    expect(Object.keys(channelCapabilities)).toHaveLength(5)
    expect(channelCapabilities).not.toHaveProperty('facebook')
  })
})
