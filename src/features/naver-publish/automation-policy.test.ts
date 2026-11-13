import { describe, expect, it } from 'vitest'
import {
  NAVER_AUTOMATION_ACTIONS,
  NAVER_CAPABILITIES,
  NaverAutomationPolicyError,
  assertNaverAutomationAllowed,
  isNaverAutomationAction,
  naverAutomationBlocked,
} from './automation-policy'

describe('naver automation policy (single source of truth)', () => {
  it('denies every external automation capability and allows the manual handoff set', () => {
    for (const key of ['browser_login', 'browser_fill', 'browser_publish', 'browser_schedule', 'automated_comment_read', 'automated_comment_reply', 'implicit_html_readback'] as const) {
      expect(NAVER_CAPABILITIES[key]).toBe(false)
    }
    for (const key of ['draft_generate', 'image_generate', 'manual_copy', 'manual_export', 'open_official_editor_link', 'owner_report_url', 'owner_supplied_review'] as const) {
      expect(NAVER_CAPABILITIES[key]).toBe(true)
    }
  })

  it('throws POLICY_DISABLED for every automation action regardless of caller context', () => {
    for (const action of NAVER_AUTOMATION_ACTIONS) {
      expect(() => assertNaverAutomationAllowed(action)).toThrow(NaverAutomationPolicyError)
      try {
        assertNaverAutomationAllowed(action)
      } catch (error) {
        expect((error as NaverAutomationPolicyError).code).toBe('POLICY_DISABLED')
      }
    }
  })

  it('builds a side-effect-free 403 body without leaking internals', async () => {
    const response = naverAutomationBlocked('publish')
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.errorCode).toBe('POLICY_DISABLED')
    expect(body.error).toContain('직접')
    expect(JSON.stringify(body)).not.toMatch(/cookie|password|token/i)
  })

  it('recognises action names', () => {
    expect(isNaverAutomationAction('publish')).toBe(true)
    expect(isNaverAutomationAction('copy')).toBe(false)
  })
})
