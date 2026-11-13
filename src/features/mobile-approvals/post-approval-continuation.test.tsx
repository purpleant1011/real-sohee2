import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PostApprovalContinuation } from './post-approval-continuation'

const id = '00000000-0000-4000-8000-000000000001'
const workspaceId = '11111111-1111-4111-8111-111111111111'
const draft = { datasetMode: 'ACTUAL', workspaceId, missionId: id,
  status: 'AWAITING_EXACT_APPROVAL', createdAt: '2026-10-28T00:00:00Z', topic: '매장 소식', goal: '소식 알리기',
  approvalFingerprint: 'a'.repeat(64), selectedImageIds: [],
  rights: { rightsStatus: 'OWNED', consentStatus: 'NOT_APPLICABLE' },
  boundVersions: { knowledge: 1, textHarness: 1, imageHarness: 1, policy: 1 },
  copies: { instagram: { caption: '저장한 게시 문안', cta: '' }, threads: { content: '저장한 스레드 문안', cta: '' } },
  channels: [{ provider: 'instagram', handle: '@shop', connection: 'CONNECTED', publishPermission: 'GRANTED' }] }
afterEach(() => vi.unstubAllGlobals())

it('opens the stored post editor from approval without relying on a separate page flag or writing', async () => {
  const requests: { url: string; options?: RequestInit }[] = []
  vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
    requests.push({ url, options })
    return new Response(JSON.stringify({ success: true, missionStatus: 'AWAITING_APPROVAL', draft }))
  })
  render(<PostApprovalContinuation item={`post:${id}`} workspaceId={workspaceId} />)
  fireEvent.click(screen.getByRole('button', { name: '게시물 수정·최종 승인' }))
  await waitFor(() => expect(document.querySelector('[data-first-post-preview]')).toBeTruthy())
  expect(screen.getByLabelText('인스타그램 문구')).toHaveValue('저장한 게시 문안')
  fireEvent.change(screen.getByLabelText('인스타그램 문구'), { target: { value: '직접 수정한 게시 문안' } })
  expect(screen.getByRole('button', { name: '변경 저장' })).toBeEnabled()
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ url: `/api/missions/first-post/${id}`, options: { method: 'GET', cache: 'no-store', headers: { 'x-workspace-id': workspaceId } } })
})
it('does not reopen approved posts for another publish', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true, missionStatus: 'APPROVED', draft })))
  render(<PostApprovalContinuation item={`post:${id}`} workspaceId={workspaceId} />)
  fireEvent.click(screen.getByRole('button', { name: '게시물 수정·최종 승인' }))
  expect(await screen.findByRole('link', { name: '게시 결과 확인' })).toHaveAttribute('href', `/app/outcome/${id}`)
  expect(document.querySelector('[data-first-post-preview]')).toBeNull()
})
it('keeps another workspace draft out of the editor', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true, missionStatus: 'DRAFT', draft: { ...draft, workspaceId: 'other' } })))
  render(<PostApprovalContinuation item={`post:${id}`} workspaceId={workspaceId} />)
  fireEvent.click(screen.getByRole('button', { name: '게시물 수정·최종 승인' }))
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(document.querySelector('[data-first-post-preview]')).toBeNull()
})
it('does not open unverified dataset drafts even when the approval summary was actual', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true, missionStatus: 'DRAFT', draft: { ...draft, datasetMode: 'UNKNOWN' } })))
  render(<PostApprovalContinuation item={`post:${id}`} workspaceId={workspaceId} />)
  fireEvent.click(screen.getByRole('button', { name: '게시물 수정·최종 승인' }))
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(screen.queryByLabelText('인스타그램 문구')).toBeNull()
})
it('does not reopen missions with unknown lifecycle states', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true, missionStatus: 'UNKNOWN', draft })))
  render(<PostApprovalContinuation item={`post:${id}`} workspaceId={workspaceId} />)
  fireEvent.click(screen.getByRole('button', { name: '게시물 수정·최종 승인' }))
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(screen.queryByLabelText('인스타그램 문구')).toBeNull()
})
it('keeps legacy posts without stored drafts distinct from a usable editor', async () => {
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }))
  render(<PostApprovalContinuation item={`post:${id}`} workspaceId={workspaceId} />)
  fireEvent.click(screen.getByRole('button', { name: '게시물 수정·최종 승인' }))
  expect(await screen.findByRole('link', { name: '작업 상세 확인' })).toHaveAttribute('href', `/app/missions/${id}?step=preview`)
  expect(screen.queryByLabelText('인스타그램 문구')).toBeNull()
})
it('distinguishes unavailable drafts from a successful review', async () => {
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 503 }))
  render(<PostApprovalContinuation item={`post:${id}`} workspaceId={workspaceId} />)
  fireEvent.click(screen.getByRole('button', { name: '게시물 수정·최종 승인' }))
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(screen.getByRole('button', { name: '다시 불러오기' })).toBeEnabled()
  expect(document.querySelector('[data-first-post-preview]')).toBeNull()
})
