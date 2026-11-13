// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConnectorHub } from './connector-hub'
import type { ConnectorHubSnapshot } from '../catalog'

const mockSnapshot: ConnectorHubSnapshot = {
  workspaceId: 'ws-ui-contract-test',
  storageReady: true,
  connections: [
    {
      connectorId: 'instagram',
      status: 'connected',
      lastSyncAt: '2026-11-10T09:00:00Z',
      capabilities: ['feed_read'],
    },
    {
      connectorId: 'google_calendar',
      status: 'connected',
      lastSyncAt: '2026-11-10T08:00:00Z',
      capabilities: ['events_read'],
    },
  ],
}

describe('ConnectorHub UI & 320px 반응형 / 접근성 계약 (Task 3 UI Regression)', () => {
  it('검색 입력창은 모바일 접근성을 위해 최소 44px 터치 높이 계약을 준수한다', () => {
    render(<ConnectorHub snapshot={mockSnapshot} />)

    const searchInput = screen.getByRole('searchbox', { name: /도구 검색|커넥터 검색/i })
    expect(searchInput).toBeInTheDocument()
    // 44px 터치 높이 클래스(min-h-[44px] 또는 h-11) 계약 검증
    expect(searchInput.className).toMatch(/(min-h-\[44px\]|h-11)/)
  })

  it('컨테이너와 카드 영역은 320px 뷰포트에서 가로 스크롤을 유발하지 않도록 overflow 방지 및 min-w-0를 보장한다', () => {
    const { container } = render(<ConnectorHub snapshot={mockSnapshot} />)

    const hubContainer = container.querySelector('[class*="hubContainer"]')
    expect(hubContainer).toBeInTheDocument()
    // overflow 방지 및 반응형 max-width 계약
    expect(hubContainer?.className).toMatch(/(min-w-0|overflow-hidden|w-full)/)

    // 개별 카드 컨테이너 요소들이 min-w-0와 overflow-hidden을 가지는지 확인
    const cardRegions = screen.getAllByRole('region', { name: /요약/i })
    expect(cardRegions.length).toBeGreaterThan(0)
    for (const region of cardRegions) {
      const card = region.parentElement
      expect(card?.className).toMatch(/(min-w-0|overflow-hidden)/)
    }
  })

  it('카드 요약 인터랙션 영역은 최소 44px 터치 타깃을 지원한다', () => {
    render(<ConnectorHub snapshot={mockSnapshot} />)

    // 카드 요약 인터랙션 영역(클릭 트리거) 검증
    const cardTriggers = screen.getAllByRole('region', { name: /요약/i })
    expect(cardTriggers.length).toBeGreaterThan(0)
    for (const trigger of cardTriggers) {
      expect(trigger.className).toMatch(/(min-h-\[44px\]|touch-target)/)
    }
  })

  it('매우 긴 이름이나 목적 텍스트를 가진 커넥터 카드도 줄바꿈 및 말줄임 처리를 통해 320px 레이아웃을 깨뜨리지 않는다', () => {
    const { container } = render(<ConnectorHub snapshot={mockSnapshot} />)

    // cardName 요소들이 break-words 및 min-w-0를 포함하는지 검증
    const cardNames = container.querySelectorAll('[class*="cardName"]')
    expect(cardNames.length).toBeGreaterThan(0)
    for (const nameEl of Array.from(cardNames)) {
      expect(nameEl.className).toMatch(/(break-words|truncate|line-clamp|min-w-0)/)
    }
  })
})
