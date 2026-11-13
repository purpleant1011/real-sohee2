import { afterEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrainKnowledgeTab } from '../brain-knowledge-tab'

it('미입력 템플릿과 출처 미확인 지식은 확정으로 표시하지 않는다', async () => {
  const base = { category: 'MENU', status: 'active', approvedAt: '2026-11-02T00:00:00Z', validFrom: '2026-11-02T00:00:00Z', usedBy: [], createdAt: '2026-11-02T00:00:00Z', versionTimestamp: '2026-11-02T00:00:00Z' }
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, data: [
    { ...base, id: 'placeholder', content: '대표 메뉴는 [시그니처 메뉴]입니다.', source: { kind: 'owner_statement', sourceId: 'one' } },
    { ...base, id: 'unknown', content: '대표 서비스 상담', source: { kind: 'unknown', sourceId: 'two' } },
    { ...base, id: 'real', content: '영업시간은 오전 10시부터입니다.', source: { kind: 'owner_statement', sourceId: 'three' } },
  ] })))
  render(<BrainKnowledgeTab workspaceId="shop" />)
  await screen.findByText('대표 메뉴는 [시그니처 메뉴]입니다.')
  expect(screen.getAllByText('확인 필요')).toHaveLength(2)
  expect(screen.getAllByText('확정됨')).toHaveLength(1)
})

afterEach(() => vi.unstubAllGlobals())
