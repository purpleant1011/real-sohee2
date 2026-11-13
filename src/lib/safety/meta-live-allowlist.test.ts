import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getMetaLiveAllowlistStatus,
  isMetaLiveAllowed,
  parseMetaLiveAllowlist,
} from './meta-live-allowlist'

describe('meta-live-allowlist', () => {
  const originalEnv = process.env.META_LIVE_WORKSPACE_ALLOWLIST
  const validUuid1 = '00000000-0000-4000-8000-0000000000a1'
  const validUuid2 = '00000000-0000-4000-8000-0000000000a2'
  const validUuid3 = '3156b2d4-77f8-42c3-a8ac-6b9cc473dfec'

  beforeEach(() => {
    delete process.env.META_LIVE_WORKSPACE_ALLOWLIST
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = originalEnv
    } else {
      delete process.env.META_LIVE_WORKSPACE_ALLOWLIST
    }
  })

  describe('isMetaLiveAllowed (Fail-Closed)', () => {
    it('returns false when env is unset', () => {
      expect(isMetaLiveAllowed(validUuid1)).toBe(false)
      expect(getMetaLiveAllowlistStatus()).toEqual({
        live_allowlist_configured: false,
        live_allowlist_all: false,
        live_allowlist_count: 0,
      })
    })

    it('returns false when env is empty string or only whitespace', () => {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = ''
      expect(isMetaLiveAllowed(validUuid1)).toBe(false)
      expect(getMetaLiveAllowlistStatus().live_allowlist_configured).toBe(false)

      process.env.META_LIVE_WORKSPACE_ALLOWLIST = '   \t  \n  '
      expect(isMetaLiveAllowed(validUuid1)).toBe(false)
      expect(getMetaLiveAllowlistStatus().live_allowlist_configured).toBe(false)
    })

    it('returns false when workspaceId is null, undefined, empty, or whitespace', () => {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = '*'
      expect(isMetaLiveAllowed(null)).toBe(false)
      expect(isMetaLiveAllowed(undefined)).toBe(false)
      expect(isMetaLiveAllowed('')).toBe(false)
      expect(isMetaLiveAllowed('   ')).toBe(false)
    })

    it('returns false when workspaceId is non-UUID when explicit allowlist is used', () => {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = validUuid1
      expect(isMetaLiveAllowed('not-a-uuid')).toBe(false)
      expect(isMetaLiveAllowed('12345')).toBe(false)
    })

    it('allows all workspaces when env is trimmed "*"', () => {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = '*'
      expect(isMetaLiveAllowed(validUuid1)).toBe(true)
      expect(isMetaLiveAllowed(validUuid2)).toBe(true)
      expect(isMetaLiveAllowed('ws-test')).toBe(true)

      expect(getMetaLiveAllowlistStatus()).toEqual({
        live_allowlist_configured: true,
        live_allowlist_all: true,
        live_allowlist_count: 0,
      })

      // With surrounding whitespace
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = '   *   \n'
      expect(isMetaLiveAllowed(validUuid1)).toBe(true)
      expect(getMetaLiveAllowlistStatus().live_allowlist_all).toBe(true)
    })

    it('does NOT treat "*" as wildcard if it is not the sole entry value', () => {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = `*, ${validUuid1}`
      // '*' is not sole trimmed value, and '*' is not a valid UUID token, so only validUuid1 is parsed
      expect(isMetaLiveAllowed(validUuid1)).toBe(true)
      expect(isMetaLiveAllowed(validUuid2)).toBe(false)
      expect(getMetaLiveAllowlistStatus()).toEqual({
        live_allowlist_configured: true,
        live_allowlist_all: false,
        live_allowlist_count: 1,
      })
    })

    it('parses comma and whitespace separated UUIDs', () => {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = `${validUuid1},  ${validUuid2}\n\t${validUuid3}`
      expect(isMetaLiveAllowed(validUuid1)).toBe(true)
      expect(isMetaLiveAllowed(validUuid2)).toBe(true)
      expect(isMetaLiveAllowed(validUuid3)).toBe(true)
      expect(isMetaLiveAllowed('00000000-0000-0000-0000-000000000000')).toBe(false)

      expect(getMetaLiveAllowlistStatus()).toEqual({
        live_allowlist_configured: true,
        live_allowlist_all: false,
        live_allowlist_count: 3,
      })
    })

    it('matches exact UUID case-insensitively', () => {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = validUuid1.toUpperCase()
      expect(isMetaLiveAllowed(validUuid1.toLowerCase())).toBe(true)
      expect(isMetaLiveAllowed(validUuid1.toUpperCase())).toBe(true)
    })

    it('ignores malformed entries without failing', () => {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = `malformed-entry, 12345, ${validUuid1}, invalid-uuid`
      expect(isMetaLiveAllowed(validUuid1)).toBe(true)
      expect(isMetaLiveAllowed(validUuid2)).toBe(false)
      expect(getMetaLiveAllowlistStatus().live_allowlist_count).toBe(1)
    })

    it('never treats substring of a valid UUID as a match', () => {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = validUuid1
      const substring = validUuid1.slice(0, -4) + '0000'
      expect(isMetaLiveAllowed(substring)).toBe(false)
    })
  })

  describe('parseMetaLiveAllowlist', () => {
    it('handles null/undefined gracefully', () => {
      expect(parseMetaLiveAllowlist(null)).toEqual({
        isAll: false,
        allowedUuids: new Set(),
        count: 0,
      })
      expect(parseMetaLiveAllowlist(undefined)).toEqual({
        isAll: false,
        allowedUuids: new Set(),
        count: 0,
      })
    })
  })
})
