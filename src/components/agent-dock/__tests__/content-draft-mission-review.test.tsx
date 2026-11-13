import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ContentDraftCard } from '../content-draft-card'

const scope = { workspaceId: 'workspace-1', missionId: 'mission-1', runId: 'run-1', contentId: 'content-1', versionId: 'version-1' }
const card = { draftId: 'draft-1', topic: '매장 안내', variants: [{ channel: 'instagram' as const, caption: '이전 원고', hashtags: [], status: 'READY' as const, statusLabel: '검토 필요', issues: [], contentId: scope.contentId, versionId: scope.versionId, vaultSavable: false }] }
const preview = { ...scope, fingerprint: 'a'.repeat(64), channel: 'instagram', account: { label: '@reviewed', connectionId: 'connection-1', status: 'connected' }, text: '견적에 연결된 최신 원고', disclosure: 'AI 보조 제작', issues: [], media: [{ id: 'photo-1', position: 1, src: '/photo-1', altText: '견적과 함께 검토한 사진' }] }
let quote: Record<string, any>
let writes: { url: string; body: any }[]
let failApproval: boolean
let responseScope: string
let pendingQuote: (() => void) | undefined
let omitDisclosure: boolean
let approvalOverride: Record<string, unknown>
beforeEach(() => {
  quote = { ...scope, quoteId: 'quote-1', actionType: 'SNS_DIRECT_PUBLISH', requiredCredits: 50, reviewFingerprint: 'b'.repeat(64), issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 900000).toISOString(), executionAllowed: false }
  writes = []; failApproval = false; responseScope = scope.workspaceId; pendingQuote = undefined
  omitDisclosure = false; approvalOverride = {}
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)); writes.push({ url, body })
      if (body.action === 'ISSUE_QUOTE') {
        if (pendingQuote) await new Promise<void>(resolve => { pendingQuote = resolve })
        return Response.json({ success: true, quote: { ...quote, workspaceId: responseScope }, preview: { ...preview, ...(omitDisclosure ? { disclosure: undefined } : {}) } })
      }
      if (failApproval) return Response.json({ success: false, error: { code: 'MISSION_REVIEW_SAVE_UNCONFIRMED' } }, { status: 409 })
      return Response.json({ success: true, reviewApproval: { ...scope, approvalId: 'approval-1', quoteId: quote.quoteId,
        reviewFingerprint: quote.reviewFingerprint, requiredCredits: 50, state: 'REVIEW_APPROVED', executionAllowed: false,
        rightsConfirmed: true, disclosureConfirmed: true, decidedBy: 'server-actor', decidedAt: new Date().toISOString(), ...approvalOverride } })
    }
    return Response.json({ ...scope, artifactReview: { preview: { ...preview, text: '최초 조회 원고' }, cost: { state: 'UNKNOWN' }, approvalAllowed: false, blockers: ['비용 확인 필요'] } })
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })
const view = () => render(<ContentDraftCard card={card} workspaceId={scope.workspaceId} missionId={scope.missionId} runId={scope.runId} />)
async function loadQuote() {
  fireEvent.click(screen.getByRole('button', { name: '원고·사진·승인 조건 확인' }))
  fireEvent.click(await screen.findByRole('button', { name: '게시 견적 확인' }))
  await screen.findByText('게시 견적: 50크레딧')
}
it('저장 견적의 최신 원고·사진·계정과 비용을 표시하고 권리 동의 전 승인을 막는다', async () => {
  view(); await loadQuote()
  expect(screen.getByText('견적에 연결된 최신 원고')).toBeInTheDocument()
  expect(screen.queryByText('최초 조회 원고')).not.toBeInTheDocument()
  expect(screen.getByText('AI 보조 제작')).toBeInTheDocument()
  expect(screen.getByRole('img', { name: '견적과 함께 검토한 사진' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '검토 내용에 동의하고 저장' })).toBeDisabled()
  expect(writes).toEqual([{ url: `/api/workspaces/${scope.workspaceId}/agent/artifact-review`, body: { action: 'ISSUE_QUOTE', missionId: scope.missionId, runId: scope.runId, contentId: scope.contentId, versionId: scope.versionId } }])
})
it('원고·사진 권리와 표시 동의 후 정확한 견적만 승인하고 게시 요청은 보내지 않는다', async () => {
  view(); await loadQuote()
  fireEvent.click(screen.getByRole('checkbox', { name: '원고와 사진의 사용 권리를 확인했습니다' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '게시 계정과 AI 보조 제작 표시를 확인했습니다' }))
  fireEvent.click(screen.getByRole('button', { name: '검토 내용에 동의하고 저장' }))
  await screen.findByText('검토 동의가 저장되었습니다. 게시하거나 발송하지 않았습니다.')
  expect(writes[1]).toEqual({ url: `/api/workspaces/${scope.workspaceId}/agent/artifact-review`, body: {
    action: 'APPROVE_REVIEW', missionId: scope.missionId, runId: scope.runId, contentId: scope.contentId, versionId: scope.versionId,
    quoteId: 'quote-1', reviewFingerprint: 'b'.repeat(64), rightsConfirmed: true, disclosureConfirmed: true,
  } })
  expect(writes).toHaveLength(2)
})
it('다른 작업공간의 견적은 표시하거나 승인하지 않는다', async () => {
  responseScope = 'other-workspace'
  view()
  fireEvent.click(screen.getByRole('button', { name: '원고·사진·승인 조건 확인' }))
  fireEvent.click(await screen.findByRole('button', { name: '게시 견적 확인' }))
  await screen.findByRole('alert')
  expect(screen.queryByText('게시 견적: 50크레딧')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '승인 조건 확인 필요' })).toBeDisabled()
})
it('저장 결과 미확인은 승인 성공으로 표시하지 않고 재검토를 요구한다', async () => {
  failApproval = true
  view(); await loadQuote()
  fireEvent.click(screen.getByRole('checkbox', { name: '원고와 사진의 사용 권리를 확인했습니다' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '게시 계정과 AI 보조 제작 표시를 확인했습니다' }))
  fireEvent.click(screen.getByRole('button', { name: '검토 내용에 동의하고 저장' }))
  await screen.findByRole('alert')
  expect(screen.queryByText('검토 동의가 저장되었습니다. 게시하거나 발송하지 않았습니다.')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '승인 조건 확인 필요' })).toBeDisabled()
})
it('화면의 견적 만료 시 승인 버튼을 제거한다', async () => {
  quote.expiresAt = new Date(Date.now() + 1000).toISOString()
  view(); await loadQuote()
  await waitFor(() => expect(screen.queryByRole('button', { name: '검토 내용에 동의하고 저장' })).not.toBeInTheDocument(), { timeout: 2500 })
  expect(screen.getByRole('alert')).toHaveTextContent('견적이 만료되었습니다')
})
it('제작 표시가 누락된 견적 스냅샷에는 동의를 받지 않는다', async () => {
  omitDisclosure = true
  view()
  fireEvent.click(screen.getByRole('button', { name: '원고·사진·승인 조건 확인' }))
  fireEvent.click(await screen.findByRole('button', { name: '게시 견적 확인' }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.queryByText('게시 견적: 50크레딧')).not.toBeInTheDocument()
})
it.each([
  { missionId: 'other-mission' }, { quoteId: 'other-quote' }, { executionAllowed: true },
  { decidedBy: '' }, { decidedAt: 'invalid-date' },
])('정확 승인 영수증이 불완전하면 저장 성공으로 표시하지 않는다: %j', async override => {
  approvalOverride = override
  view(); await loadQuote()
  fireEvent.click(screen.getByRole('checkbox', { name: '원고와 사진의 사용 권리를 확인했습니다' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '게시 계정과 AI 보조 제작 표시를 확인했습니다' }))
  fireEvent.click(screen.getByRole('button', { name: '검토 내용에 동의하고 저장' }))
  await screen.findByRole('alert')
  expect(screen.queryByText('검토 동의가 저장되었습니다. 게시하거나 발송하지 않았습니다.')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '승인 조건 확인 필요' })).toBeDisabled()
  expect(writes).toHaveLength(2)
})
it('미션 전환 후 늦게 도착한 견적 응답은 새 미션에 반영하지 않는다', async () => {
  pendingQuote = () => undefined
  const rendered = view()
  fireEvent.click(screen.getByRole('button', { name: '원고·사진·승인 조건 확인' }))
  fireEvent.click(await screen.findByRole('button', { name: '게시 견적 확인' }))
  rendered.rerender(<ContentDraftCard card={card} workspaceId={scope.workspaceId} missionId="other-mission" runId="other-run" />)
  await act(async () => { pendingQuote?.() })
  expect(screen.queryByText('게시 견적: 50크레딧')).not.toBeInTheDocument()
  expect(screen.queryByText('견적에 연결된 최신 원고')).not.toBeInTheDocument()
})
