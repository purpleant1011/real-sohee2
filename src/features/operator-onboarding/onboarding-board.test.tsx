import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingBoard from './onboarding-board'

describe('OnboardingBoard visual parity structure', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  })
  it('shows KPI, pipeline, document management and detail panel surfaces', () => {
    render(<OnboardingBoard />)
    expect(screen.getByText('신규 가입')).toBeVisible()
    expect(screen.getByText('서류 검토')).toBeVisible()
    expect(screen.getByText('활성화 완료')).toBeVisible()
    expect(screen.getByRole('heading', { name: '약관·동의 문서 관리' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '검토 항목' })).toBeVisible()
    expect(screen.getAllByText('상세 정보').length).toBeGreaterThan(0)
  })

  it('shows safe reconsent targets without offering customer consent actions', () => {
    render(<OnboardingBoard reconsentTargets={[{ documentType: 'privacy_consent', activeDocument: null, state: 'fresh', items: [{ workspace_id: '41000000-0000-4000-8000-000000000001', workspace_name: '고객사', document_type: 'privacy_consent', channel: null, active_version: 'v2', active_fingerprint: 'a'.repeat(64), prior_accepted_at: null, reason: 'document_version_outdated' }] }]} />)
    expect(screen.getByRole('heading', { name: '재동의 대상' })).toBeVisible()
    expect(screen.getByText('document_version_outdated')).toBeVisible()
    expect(screen.queryByRole('button', { name: /동의|수락|대행/ })).toBeNull()
  })

  it('places connected customers in their actual lifecycle stage', () => {
    render(<OnboardingBoard overviews={[{
      workspaceId: '41000000-0000-4000-8000-000000000001',
      workspaceName: '바이름',
      lifecycle: { state: 'fresh', data: { status: 'contract_review', version: 1, changedAt: '2026-08-24T00:00:00.000Z' } },
      agreements: { state: 'empty', data: [] },
      delegations: { state: 'empty', data: [] },
      activation: { ready: false, missing: ['service_agreement'] },
    }]} />)

    expect(screen.getByText('1개사')).toBeVisible()
    expect(screen.getAllByText('바이름').length).toBeGreaterThan(0)
    expect(screen.getByText('서비스 계약')).toBeVisible()
  })
})
