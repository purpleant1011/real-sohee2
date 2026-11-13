import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { MobileApprovalScreen } from './mobile-approval-view'
import { makeMobileApproval } from './test-fixtures'
it('shows the full stored draft and never offers an executable action in R1', () => {
  const view = makeMobileApproval()
  let returned = false
  render(<MobileApprovalScreen view={view} onBack={() => { returned = true }} onRefresh={() => {}} />)
  expect(screen.getByText(view.sourceText!)).toBeVisible()
  expect(screen.getByText(view.fullContent!)).toBeVisible()
  expect(screen.getByText('현재는 검토만 가능해요')).toBeVisible()
  expect(screen.getByText('테스트 예시는 전송하지 않아요.')).toBeVisible()
  expect(screen.queryByRole('button', { name: '승인하고 전송' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '목록으로 돌아가기' }))
  expect(returned).toBe(true)
})
it('connects actual posts to their existing mission review instead of a permanent safety placeholder', () => {
  const view = { ...makeMobileApproval(), id: 'post:00000000-0000-4000-8000-000000000001', kind: 'post_publish' as const, datasetMode: 'ACTUAL' as const }
  render(<MobileApprovalScreen view={view} onBack={() => {}} onRefresh={() => {}} />)
  expect(screen.getByRole('button', { name: '게시물 수정·최종 승인' })).toBeEnabled()
  expect(screen.queryByText('실행 전 근거 확인 필요')).not.toBeInTheDocument()
  expect(screen.queryByText('비용·사진 권리·예약 시간은 아직 실행 근거로 확인되지 않았어요.')).not.toBeInTheDocument()
})
it('does not describe an unknown dataset as a test example', () => {
  render(<MobileApprovalScreen view={{ ...makeMobileApproval(), datasetMode: 'UNKNOWN' }} onBack={() => {}} onRefresh={() => {}} />)
  expect(screen.queryByText('테스트 예시는 전송하지 않아요.')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '게시물 수정·최종 승인' })).not.toBeInTheDocument()
})
it('distinguishes missing content and recipient from a ready approval', () => {
  render(<MobileApprovalScreen view={{ ...makeMobileApproval(), targetLabel: null, fullContent: null }} onBack={() => {}} onRefresh={() => {}} />)
  expect(screen.getByText('대상 계정 확인 필요')).toBeVisible()
  expect(screen.getByText('전체 초안이 아직 준비되지 않았어요')).toBeVisible()
  expect(screen.getByText('테스트 예시는 전송하지 않아요.')).toBeVisible()
  expect(screen.queryByRole('button', { name: '승인하고 전송' })).not.toBeInTheDocument()
})
