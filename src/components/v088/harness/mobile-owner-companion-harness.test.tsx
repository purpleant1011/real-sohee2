import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MobileOwnerCompanionHarness } from './mobile-owner-companion-harness'
import { HarnessAsset } from '@/types/harness'

describe('MobileOwnerCompanionHarness (ANI-261)', () => {
  it('renders 24h estimated SC budget and active harness count', () => {
    const mockAssets: HarnessAsset[] = [
      {
        id: 'h1',
        workspaceId: 'ws_1',
        assetType: 'ATOMIC_SOURCE',
        title: '스튜디오 바이름 인스타',
        visibility: 'PRIVATE',
        overallStatus: 'READY',
        activeVersionId: 'v1',
        activeVersionNo: 1,
        platform: 'instagram',
        sourceUrl: 'https://instagram.com/studio_by.reum',
        coreDna: [],
        moduleReadiness: { text: 'READY', visual: 'READY', operations: 'READY', community: 'READY', platform: 'READY' },
        dailyEstimatedSc: 120,
        totalSpentSc: 500,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'h2',
        workspaceId: 'ws_1',
        assetType: 'ATOMIC_SOURCE',
        title: '누르브로우 블로그',
        visibility: 'PRIVATE',
        overallStatus: 'READY',
        activeVersionId: 'v2',
        activeVersionNo: 1,
        platform: 'naver_blog',
        sourceUrl: 'https://blog.naver.com/noorbrow',
        coreDna: [],
        moduleReadiness: { text: 'READY', visual: 'READY', operations: 'READY', community: 'READY', platform: 'READY' },
        dailyEstimatedSc: 80,
        totalSpentSc: 300,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]

    render(<MobileOwnerCompanionHarness assets={mockAssets} />)

    // 크레딧 숫자(200) 및 SC 등 기술/비용 단어 숨김, 쉬운 말 표기
    expect(screen.queryByText('200')).toBeNull()
    expect(screen.queryByText(/SC/)).toBeNull()
    expect(screen.getByText('정상 운영')).toBeDefined()
    expect(screen.getByText('2개 사용 중')).toBeDefined()
    expect(screen.getByText('스튜디오 바이름 인스타')).toBeDefined()
    expect(screen.getByText('누르브로우 블로그')).toBeDefined()
  })
})
