import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getEngagementAllowlistStatus,
  isEngagementFeatureOn,
  isEngagementWorkspaceAllowed,
} from './engagement-allowlist'

describe('engagement-allowlist', () => {
  const originalEnv = { ...process.env }
  const WS_1 = '00000000-0000-4000-8000-0000000000a1'
  const WS_2 = '00000000-0000-4000-8000-0000000000a2'
  const NOT_ALLOWED = '00000000-0000-0000-0000-000000000000'

  beforeEach(() => {
    delete process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
    delete process.env.ENGAGEMENT_CYCLE_ENABLED
    delete process.env.ENGAGEMENT_SEND_ENABLED
    delete process.env.ENGAGEMENT_DM_INGEST_ENABLED
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('isEngagementWorkspaceAllowed', () => {
    it('returns false when ENGAGEMENT_WORKSPACE_ALLOWLIST is unset (fail closed)', () => {
      delete process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
      expect(isEngagementWorkspaceAllowed(WS_1)).toBe(false)
    })

    it('returns false when ENGAGEMENT_WORKSPACE_ALLOWLIST is empty or whitespace', () => {
      process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '   '
      expect(isEngagementWorkspaceAllowed(WS_1)).toBe(false)
    })

    it('returns false for invalid or missing workspace IDs even if allowlist is configured', () => {
      process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'
      expect(isEngagementWorkspaceAllowed(null)).toBe(false)
      expect(isEngagementWorkspaceAllowed(undefined)).toBe(false)
      expect(isEngagementWorkspaceAllowed('')).toBe(false)
      expect(isEngagementWorkspaceAllowed('invalid-uuid')).toBe(false)
    })

    it('matches UUIDs in comma/whitespace separated list case-insensitively', () => {
      process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = `${WS_1.toUpperCase()} ,  ${WS_2}`
      expect(isEngagementWorkspaceAllowed(WS_1.toLowerCase())).toBe(true)
      expect(isEngagementWorkspaceAllowed(WS_2.toUpperCase())).toBe(true)
      expect(isEngagementWorkspaceAllowed(NOT_ALLOWED)).toBe(false)
    })

    it('returns true for any valid UUID when allowlist is *', () => {
      process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'
      expect(isEngagementWorkspaceAllowed(WS_1)).toBe(true)
      expect(isEngagementWorkspaceAllowed(NOT_ALLOWED)).toBe(true)
      expect(isEngagementWorkspaceAllowed('not-a-uuid')).toBe(false)
    })
  })

  describe('getEngagementAllowlistStatus', () => {
    it('returns 0/false when unset or empty', () => {
      delete process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
      expect(getEngagementAllowlistStatus()).toEqual({
        configured: false,
        all: false,
        count: 0,
      })
    })

    it('returns configured=true, all=false, count=N for UUID list', () => {
      process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = `${WS_1}, ${WS_2}`
      expect(getEngagementAllowlistStatus()).toEqual({
        configured: true,
        all: false,
        count: 2,
      })
    })

    it('returns configured=true, all=true, count=0 for wildcard *', () => {
      process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'
      expect(getEngagementAllowlistStatus()).toEqual({
        configured: true,
        all: true,
        count: 0,
      })
    })
  })

  describe('isEngagementFeatureOn', () => {
    it('returns false if flag is unset, even if workspace is allowlisted', () => {
      process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'
      expect(isEngagementFeatureOn('ENGAGEMENT_SEND_ENABLED', WS_1)).toBe(false)
    })

    it('returns false if flag is 0, even if workspace is allowlisted', () => {
      process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'
      process.env.ENGAGEMENT_SEND_ENABLED = '0'
      expect(isEngagementFeatureOn('ENGAGEMENT_SEND_ENABLED', WS_1)).toBe(false)
    })

    it('returns false if flag is 1, but workspace is not in allowlist', () => {
      process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = WS_1
      process.env.ENGAGEMENT_CYCLE_ENABLED = '1'
      expect(isEngagementFeatureOn('ENGAGEMENT_CYCLE_ENABLED', NOT_ALLOWED)).toBe(false)
    })

    it('returns true only when flag is 1 AND workspace is allowlisted', () => {
      process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = WS_1
      process.env.ENGAGEMENT_DM_INGEST_ENABLED = '1'
      expect(isEngagementFeatureOn('ENGAGEMENT_DM_INGEST_ENABLED', WS_1)).toBe(true)
      expect(isEngagementFeatureOn('ENGAGEMENT_DM_INGEST_ENABLED', WS_2)).toBe(false)
    })
  })
})
