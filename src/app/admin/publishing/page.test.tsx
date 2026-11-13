import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../features/operator-auth/require-operator', () => ({
  requireOperatorAnyScope: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })),
}))

vi.mock('../../../features/operator-publishing/publish-read-repository', () => ({
  listOperatorPublishOperations: vi.fn(async () => ({ data: null, error: 'PUBLISH_READ_UNAVAILABLE' })),
}))
vi.mock('../../../features/operator-workspaces/repository', () => ({
  listOperatorWorkspaces: vi.fn(async () => ({ data: { items: [] }, error: null })),
}))

import { requireOperatorAnyScope } from '../../../features/operator-auth/require-operator'
import { listOperatorPublishOperations } from '../../../features/operator-publishing/publish-read-repository'
import Page from './page'
import { publishingView } from '../../../features/operator-publishing/operator-admin-configs'
import { OperatorAdminView } from '../../../features/operator-publishing/operator-admin-view'

const row = (displayState: string, channel = 'instagram') => ({
  workspaceId: '10000000-0000-4000-8000-000000000001', workspaceName: '테스트 매장', contentId: '20000000-0000-4000-8000-000000000002',
  contentTitle: '봄 신메뉴', channel, scheduleId: null, displayState, publishAt: null, publishedAt: '2026-10-08T02:00:00.000Z', destinationUrlPresent: true,
})

const dump = (v: unknown) => JSON.stringify(v, (k, x) => (k === 'type' ? undefined : x))

describe('OperatorPublishingPage', () => {
  it('guards publishing and shows a load error instead of zeros when the read fails', async () => {
    const view = await Page()
    expect(requireOperatorAnyScope).toHaveBeenCalledWith('publish.read')
    const text = dump(view)
    expect(text).toContain('발행 내역')
    expect(text).toContain('외부 대사 열기')
    expect(text).toContain('/admin/reconcile')
    expect(text).not.toMatch(/Read-After-Write|실운영 모드|4채널 즉시 재대사|실시간|공급자 결과 확인됨/)
  })

  it('shows the authentication action when the publishing RPC requires MFA', async () => {
    vi.mocked(listOperatorPublishOperations).mockResolvedValueOnce({ data: null, error: 'MFA_REQUIRED' })
    render(await Page())
    expect(screen.getByRole('alert')).toHaveTextContent('추가 인증(2단계)')
    expect(screen.getByRole('link', { name: '추가 인증하러 가기' })).toHaveAttribute('href', '/auth/admin-setup')
  })

  it('renders aligned Korean columns, success rate and next page link', async () => {
    vi.mocked(listOperatorPublishOperations).mockResolvedValueOnce({
      data: { items: [row('success'), row('failure', 'threads')] as never, nextCursor: 'CUR' }, error: null,
    })
    const text = dump(await Page({ searchParams: Promise.resolve({ status: 'success' }) }))
    expect(text).toContain('게시 성공률')
    expect(text).toContain('50.0%')
    expect(text).toContain('인스타그램')
    expect(text).toContain('스레드')
    expect(text).toContain('다음 페이지')
    expect(text).toContain('cursor=CUR')
    expect(text).not.toMatch(/"success"\}|failure<|instagram<|게시 ID|고객사 ID/)
    expect(vi.mocked(listOperatorPublishOperations)).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'success' }))
  })
})

it('marks unconnected filters and next actions as disabled preparation controls', () => {
  const rendered = JSON.stringify(OperatorAdminView({ config: publishingView }))
  expect(rendered).toContain('필터 연결 전')
  expect(rendered).toContain('disabled')
  expect(rendered).toContain('표시값은 준비 상태')
  expect(rendered).not.toContain('표시된 샘플')
})

it('renders supplied live summary values as connected operating data', () => {
  const rendered = JSON.stringify(OperatorAdminView({
    config: publishingView,
    liveRows: [['고객사 A', '콘텐츠 A', 'instagram', 'v2', '승인 일치', '확인 전', '확인 전', 'success', '1', '공급자 결과 확인됨', '실패 분류 없음', 'fresh']],
    liveSummary: [['오늘 예약', '1', '예약 시각 기준'], ['승인 대기', '0', '현재·승인 버전 대조'], ['게시 중', '0', '최신 게시 시도'], ['게시 완료', '1', '공급자·공개 결과 확인'], ['실패', '0', '안전한 실패 분류 기준']],
  }))
  expect(rendered).toContain('운영 자료 연결됨')
  expect(rendered).toContain('운영사 권한 범위 안의 안전한 읽기 자료')
  expect(rendered).toContain('콘텐츠 A')
})
