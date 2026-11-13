import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SystemTrustTabs } from '../system-trust-tabs'

describe('SystemTrustTabs (사업자 & 계정 정보 실데이터 바인딩)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/api/onboarding/quick-start')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            profile: {
              business_name: '바이름 청라점',
              location: '인천 서해구 청라커낼로288번길 8-10',
            },
          }),
        })
      }
      if (url.includes('/api/auth/business-verification')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            verification: {
              businessNumber: '123-45-67890',
            },
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      })
    }))
  })

  it('실제 매장 프로필 및 이메일 데이터를 바인딩하여 렌더링한다', async () => {
    render(
      <SystemTrustTabs
        workspaceId="ws-test"
        adminEmail="admin@example.com"
      />
    )

    // 이메일 즉시 반영 확인
    expect(screen.getByText('admin@example.com')).toBeInTheDocument()

    // 비동기 프로필 데이터(상호명, 사업자번호, 매장 주소) 바인딩 확인
    await waitFor(() => {
      expect(screen.getByText('바이름 청라점')).toBeInTheDocument()
      expect(screen.getByText('123-45-67890')).toBeInTheDocument()
      expect(screen.getByText('인천 서해구 청라커낼로288번길 8-10')).toBeInTheDocument()
    })
  })

  it('테스트 계정일 때는 공식 데모 스토어 정보를 렌더링한다', () => {
    render(
      <SystemTrustTabs
        workspaceId="ws-test"
        isTestAccount={true}
      />
    )

    expect(screen.getByText('소희 AI 공식 데모 스토어')).toBeInTheDocument()
    expect(screen.getByText('134-87-02941')).toBeInTheDocument()
  })

  it('요금제 탭에서 구체적인 크레딧 숫자(5,000 C)를 숨기고 이용 상태 문구를 표시한다', () => {
    render(
      <SystemTrustTabs
        workspaceId="ws-test"
        initialDomain="plan_credits"
      />
    )

    // 크레딧 숫자 노출 금지 확인
    expect(screen.queryByText(/5,000\s*C/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/무료 체험|정상 이용/).length).toBeGreaterThan(0)
  })

  it('원장, KRW 등 기술 및 금융 전문 용어 대신 쉬운 고객 친화 표현을 사용한다', () => {
    render(
      <SystemTrustTabs
        workspaceId="ws-test"
        initialDomain="plan_credits"
      />
    )

    expect(screen.getByText(/외부 매체 광고비 분리 기록 \(원\)/)).toBeInTheDocument()
    expect(screen.queryByText(/원장/)).not.toBeInTheDocument()
    expect(screen.queryByText(/KRW/)).not.toBeInTheDocument()
  })

  it('탭 라벨에 직관적이고 쉬운 한국어를 사용하며 번호 매기기를 제거한다', () => {
    render(
      <SystemTrustTabs
        workspaceId="ws-test"
      />
    )

    expect(screen.getByRole('button', { name: /사업자 정보/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /요금제 현황/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /채널 연동/ })).toBeInTheDocument()
  })
})
