import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { resolveApprovedFacts, type ApprovedFactRow } from '@/features/knowledge/approved-fact-resolver'
import { checkApprovedNaverDraft } from './approved-draft-qa'

const workspaceId = 'workspace-a'
const at = '2026-10-28T00:00:00Z'
const fact: ApprovedFactRow = {
  id: 'price-v1', workspace_id: workspaceId, category: 'PRICE', content: '커트 30,000원',
  status: 'active', source_candidate_id: 'source-1', approved_by_user_id: 'owner-1', approved_at: at,
  valid_from: at, valid_until: null, supersedes_fact_id: null, created_at: at,
}
const snapshot = (rows: ApprovedFactRow[] = []) => resolveApprovedFacts({ workspaceId, at, rows })

describe('approved Naver draft QA', () => {
  it('requires a current approved fact for a price and exposes its provenance', () => {
    const payload = { editorBlueprint: [{ kind: 'paragraph', text: '커트 30,000원' }] }
    expect(checkApprovedNaverDraft(workspaceId, payload, snapshot()).status).toBe('OWNER_CONFIRM_REQUIRED')
    const approved = snapshot([fact])
    expect(checkApprovedNaverDraft(workspaceId, payload, approved)).toMatchObject({
      status: 'OK', snapshotHash: approved.hash, resolvedAt: approved.resolvedAt,
      sources: [{ factId: fact.id, sourceCandidateId: 'source-1', approvedAt: at }],
    })
  })

  it('captures the exact approved text and its SHA-256, not the generated claim or candidate ID', () => {
    const content = '  커트 30,000원\n상담 후 진행  '
    const approved = snapshot([{ ...fact, content }])
    expect(checkApprovedNaverDraft(workspaceId, { text: '커트 30,000원' }, approved)).toHaveProperty('provenance', [{
      factId: fact.id,
      sourceType: 'owner_approved_fact',
      capturedAt: approved.resolvedAt,
      sourceSpan: content,
      sourceHash: createHash('sha256').update(content, 'utf8').digest('hex'),
      validity: 'active',
      ownerApproval: { approvedByUserId: 'owner-1', approvedAt: at },
      claimCategory: 'pricing',
    }])
  })

  it.each(['EXPERIENCE', 'RATING'])('keeps approved aggregate %s facts distinct from customer testimony', category => {
    const qa = checkApprovedNaverDraft(workspaceId, { text: '매장 안내' }, snapshot([{ ...fact, category }]))
    expect(qa).toHaveProperty('provenance.0.claimCategory', 'business_info')
  })

  it('does not fabricate provenance when there are no approved facts', () => {
    expect(checkApprovedNaverDraft(workspaceId, { text: '상담 안내' }, snapshot())).toHaveProperty('provenance', [])
  })

  it.each([
    ['EXPERIENCE', '12년 경력', '2년 경력'],
    ['EXPERIENCE', '경력 12년', '경력 1년'],
    ['RATING', '평점 4.98점', '평점 4.9'],
    ['RATING', '14.9점 평점', '4.9점 평점'],
  ])('does not accept a partial numeric %s claim', (category, content, text) => {
    const approved = snapshot([{ ...fact, category, content }])
    expect(checkApprovedNaverDraft(workspaceId, { text }, approved).status).toBe('OWNER_CONFIRM_REQUIRED')
    expect(checkApprovedNaverDraft(workspaceId, { text: content }, approved).status).toBe('OK')
  })

  it('blocks draft containing terms from approved PROHIBITED facts', () => {
    const approved = snapshot([
      { ...fact, category: 'PROHIBITED', content: '외부 음식 반입 금지' },
    ])
    const res = checkApprovedNaverDraft(workspaceId, { text: '외부 음식 반입 가능합니다' }, approved)
    expect(res.status).toBe('OWNER_CONFIRM_REQUIRED')
    expect(res.issues.some(i => i.reason.includes('주의사항') || i.reason.includes('금지'))).toBe(true)
  })

  it.each([
    '금지: 외부 음식 반입, 반려동물 동반',
    '주의사항: 외부 음식 반입\n반려동물 동반',
    '금지： 외부 음식 반입， 반려동물 동반',
  ])('checks each prohibited list item before removing separators: %s', content => {
    const approved = snapshot([{ ...fact, category: 'PROHIBITED', content }])
    for (const text of ['외부 음식 반입 가능합니다', '반려동물 동반 가능합니다']) {
      const result = checkApprovedNaverDraft(workspaceId, { editorBlueprint: [{ text }] }, approved)
      expect(result.status).toBe('OWNER_CONFIRM_REQUIRED')
      expect(result.issues.some(issue => issue.reason.includes('승인된 주의사항·금지 표현'))).toBe(true)
    }
    expect(checkApprovedNaverDraft(workspaceId, { text: '매장 위치를 안내합니다' }, approved).status).toBe('OK')
  })

  it('blocks procedure effect guarantees even if stored in approved facts without verification', () => {
    const approved = snapshot([{ ...fact, category: 'PROCEDURE_EFFECT', content: '피부 트러블 100% 완치' }])
    const res = checkApprovedNaverDraft(workspaceId, { text: '피부 트러블 100% 완치' }, approved)
    expect(res.status).toBe('OWNER_CONFIRM_REQUIRED')
  })

  it('returns specific remedy and reason for ranking guarantee claims', () => {
    const res = checkApprovedNaverDraft(workspaceId, { text: '네이버 상위노출 100% 보장합니다' }, snapshot())
    expect(res.status).toBe('OWNER_CONFIRM_REQUIRED')
    expect(res.issues.some(i => i.reason.includes('상위 노출을 단정·보장'))).toBe(true)
  })

  it('rejects cross-workspace snapshots rather than borrowing their facts', () => {
    expect(() => checkApprovedNaverDraft('workspace-b', { text: '커트 30,000원' }, snapshot([fact])))
      .toThrow('FACT_WORKSPACE_MISMATCH')
  })

  it('does not resurrect expired price evidence', () => {
    const expired = snapshot([{ ...fact, valid_from: '2026-10-01T00:00:00Z', approved_at: '2026-10-01T00:00:00Z', valid_until: at }])
    expect(checkApprovedNaverDraft(workspaceId, { text: '커트 30,000원' }, expired).status).toBe('OWNER_CONFIRM_REQUIRED')
  })

  it.each([
    'AI가 추천하는 서비스예요', '인공지능이 선정한 매장이에요', 'ChatGPT가 추천한 곳이에요',
    'ＡＩ가 추​천하는 서비스예요',
    '직접 다녀온 후기를 전해요', '저는 이용해 봤어요', '제가 다녀왔어요',
    '방문자 평점 4.98점', '20년 경력의 전문가', '제가 직접 방문해서 받아봤어요',
    '이 시술로 질병이 완치됩니다', '통증 완화 효과 보장',
    '네이버 상위노출 100% 보장', '스마트블록 1위 확정', '검색 노출 1위를 약속합니다',
    '모델 신뢰도 99% 확정', 'AI 신뢰도 99%로 보증된 품질',
  ])('blocks unsupported claims: %s', text => {
    expect(checkApprovedNaverDraft(workspaceId, { editorBlueprint: [{ text }] }, snapshot()).status).toBe('OWNER_CONFIRM_REQUIRED')
  })
  it.each([
    '먹어봤는데 정말 맛있었어요', '시술받고 왔는데 만족스러웠어요', '직접 써보니 만족스러웠어요',
    '방문해 보니 분위기가 좋았어요', '다녀온 소감을 남겨요', '고객님 후기: 너무 만족했어요',
    '실제 고객 후기를 소개합니다', '시술 전후 사진을 공개합니다', '비포 애프터 사진으로 확인하세요',
    '제가 받아보니 효과가 확실했어요', '저도 가봤는데 추천해요', '저희 단골 손님은 만족하셨습니다',
  ])('ANI-1903: blocks first-person visit, testimony and before/after claims without approved evidence: %s', text => {
    expect(checkApprovedNaverDraft(workspaceId, { editorBlueprint: [{ text }] }, snapshot()).status).toBe('OWNER_CONFIRM_REQUIRED')
  })

  it.each(['상담 전 확인할 점을 안내해요', '예약은 전화로 문의해 주세요', '다녀오는 길 주차 안내'])(
    'ANI-1903: does not over-block neutral guidance: %s', text => {
      expect(checkApprovedNaverDraft(workspaceId, { editorBlueprint: [{ text }] }, snapshot()).status).toBe('OK')
    })
})
