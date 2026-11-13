import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SystemTrustTabs } from '@/components/v088/system/system-trust-tabs'
import { systemDomainFromSection } from './navigation'
afterEach(() => vi.unstubAllGlobals())
it('maps only allowed settings sections', () => {
  expect(systemDomainFromSection('business')).toBe('account')
  expect(systemDomainFromSection('credits')).toBe('plan_credits')
  expect(systemDomainFromSection('privacy')).toBe('privacy')
  expect(systemDomainFromSection('other')).toBeNull()
})
it('opens the requested domain without enabling local simulated settings writes', () => {
  vi.stubGlobal('fetch', async () => Response.json({}))
  render(<SystemTrustTabs workspaceId="fixture" initialDomain="privacy" readOnly />)
  expect(screen.getByRole('heading', { name: /매장 데이터 및 개인정보 보호/ })).toBeVisible()
  expect(screen.getByRole('button', { name: /데이터 다운로드/ })).toBeDisabled()
})
