import { ready, unknown, type MobileHomeDto, type MobileApprovalView } from './contracts'
export const fixtureTime = '2026-10-16T01:00:00Z'
export const fixtureItemKey = 'dm:00000000-0000-4000-8000-000000000001'
export function makeMobileHome(): MobileHomeDto {
  return { workspaceId: 'fixture-ws', businessName: '우리 매장', timeZone: 'Asia/Seoul', generatedAt: fixtureTime,
    agent: unknown(), decisions: ready({ items: [], total: 0, complete: true }, fixtureTime),
    activity: unknown(), results: unknown() }
}
export function makeMobileApproval(): MobileApprovalView {
  return { workspaceId: 'fixture-ws', id: fixtureItemKey, kind: 'dm_reply', title: '고객 답장 검토',
    targetLabel: '테스트 고객', sourceText: '가격과 시간을 알고 싶어요', fullContent: '서비스를 알려주시면 확인해 드릴게요.',
    imageUrls: [], datasetMode: 'TEST', writeState: 'unsupported', reason: '현재는 검토만 가능해요' }
}
