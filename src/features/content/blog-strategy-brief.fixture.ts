// 서버 계약 회귀 테스트용 자료. 실제 사업장이나 실측 성과가 아니다.
export const marketingStrategyFixture = {
  schemaVersion: 1, id: '10000000-0000-4000-8000-000000000001', revision: 2,
  workspaceId: '20000000-0000-4000-8000-000000000001', datasetMode: 'ACTUAL',
  lineage: {
    conversationId: '30000000-0000-4000-8000-000000000001',
    missionId: '40000000-0000-4000-8000-000000000001',
    runId: '50000000-0000-4000-8000-000000000001',
  },
  businessGoal: { id: '60000000-0000-4000-8000-000000000001', outcome: 'valid_inquiry', description: '서비스 상담 문의' },
  opportunity: { id: '70000000-0000-4000-8000-000000000001', description: '상담 전 궁금한 점 안내' },
  targetAudience: '서비스 이용을 검토하는 분',
  questions: [{
    id: '80000000-0000-4000-8000-000000000001', text: '방문 전 무엇을 확인하나요?',
    source: 'verified_owner', observedAt: '2026-10-28T00:00:00Z', evidenceRef: 'owner:question-1',
    consentScope: 'approved_content', piiRedacted: true, ownerApproved: true,
  }],
  evidence: [{
    id: '90000000-0000-4000-8000-000000000001', summary: '서울 소재의 세무 상담 서비스',
    source: 'verified_owner', sourceRef: 'business_profile:owner-approved', observedAt: '2026-10-28T00:00:00Z',
  }],
  nextAction: { kind: 'inquire', instruction: '상담 가능 여부를 문의해 주세요.' },
} as const
