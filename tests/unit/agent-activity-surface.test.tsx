import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AgentArtifactPlanCard } from '@/components/agent-activity/agent-artifact-plan-card'
import { MissionEvidenceRail } from '@/components/agent-activity/mission-evidence-rail'

const plan = { planId: 'plan-1', title: '홍보 계획', steps: [{ name: '초안 검토', sc: 12 }], totalSC: 12, requiresApproval: true }
const draft = {
  missionId: 'mission-1', workspaceId: 'workspace-1', approvalFingerprint: 'a'.repeat(64),
  copies: { instagram: { caption: '처음 문구', hashtags: ['#서비스'], cta: '문의해 주세요' }, threads: { content: '스레드 원고', cta: '문의해 주세요' } },
  selectedImageIds: ['photo-1'], rights: { rightsStatus: 'OWNED', consentStatus: 'CONFIRMED' },
}
afterEach(() => vi.unstubAllGlobals())

it('근거 레일은 펼칠 때만 조회하고 확인된 0건·연결 필요·가격 정책을 구분한다', async () => {
  const requests: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    requests.push(url)
    return Response.json({ workspaceId: 'workspace-1', missionId: 'mission-1', runId: 'run-1', evidence: {
      reservations: { state: 'CONFIRMED', count: 0, observedAt: '2026-10-26T10:00:00Z' },
      channels: [{ provider: 'instagram', connection: 'NOT_CONNECTED', permission: 'UNKNOWN' }],
      price: { state: 'CONFIRMED', amountKrw: 0, source: 'FIRST_POST_POLICY' },
    } })
  })
  const view = render(<MissionEvidenceRail workspaceId="workspace-1" missionId="mission-1" runId="run-1" />)
  expect(requests).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: '판단 근거 펼치기' }))
  await screen.findByText('조회 결과 0건')
  expect(screen.getByText('인스타그램 · 연결 필요')).toBeInTheDocument()
  expect(screen.getByText('첫 게시 정책 · 게시 비용 0원')).toBeInTheDocument()
  expect(requests).toEqual(['/api/workspaces/workspace-1/agent/evidence?missionId=mission-1&runId=run-1'])
  fireEvent.click(screen.getByRole('button', { name: '판단 근거 접기' }))
  expect(screen.queryByText('조회 결과 0건')).not.toBeInTheDocument()
  view.unmount()
})

it('실행과 미션이 연결된 계획 카드에서 근거 레일을 열 수 있다', () => {
  const view = render(<AgentArtifactPlanCard plan={plan} workspaceId="workspace-1" missionId="mission-1" runId="run-1" />)
  expect(screen.getByRole('button', { name: '판단 근거 펼치기' })).toHaveAttribute('aria-expanded', 'false')
  view.unmount()
})

it('근거 조회 실패를 예약 0건으로 표시하지 않는다', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ error: 'unavailable' }, { status: 503 }))
  const view = render(<MissionEvidenceRail workspaceId="workspace-1" missionId="mission-1" runId="run-1" />)
  fireEvent.click(screen.getByRole('button', { name: '판단 근거 펼치기' }))
  await screen.findByRole('alert')
  expect(screen.queryByText('조회 결과 0건')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '근거 다시 확인' })).toBeInTheDocument()
  view.unmount()
})

it('원고를 직접 수정하고 저장본을 확인하며 기존 사진·CTA를 교체하는 요청을 보내지 않는다', async () => {
  const writes: unknown[] = []
  const onApprovalInvalidated = vi.fn()
  vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      writes.push(JSON.parse(String(init.body)))
      return Response.json({ success: true, draft: { ...draft, approvalFingerprint: 'b'.repeat(64), copies: { ...draft.copies, instagram: { ...draft.copies.instagram, caption: '수정한 문구\n줄바꿈 유지' } } } })
    }
    return Response.json({ success: true, missionStatus: 'AWAITING_APPROVAL', draft })
  })
  const view = render(<AgentArtifactPlanCard plan={plan} missionId="mission-1" workspaceId="workspace-1" onApprovalInvalidated={onApprovalInvalidated} />)
  fireEvent.click(screen.getByRole('button', { name: '홍보 초안 불러오기' }))
  const input = await screen.findByRole('textbox', { name: '인스타그램 홍보 문구' })
  fireEvent.change(input, { target: { value: '수정한 문구\n줄바꿈 유지' } })
  expect(screen.getByText('저장하지 않은 변경사항이 있습니다.')).toBeInTheDocument()
  expect(onApprovalInvalidated).toHaveBeenCalled()
  expect(writes).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: '문구 저장' }))
  await screen.findByText('문구가 저장되었습니다. 새 승인 요청에서 다시 확인해 주세요.')
  expect(writes).toEqual([{ missionId: 'mission-1', expectedFingerprint: 'a'.repeat(64), copies: { ...draft.copies, instagram: { ...draft.copies.instagram, caption: '수정한 문구\n줄바꿈 유지' } } }])
  expect(input).toHaveValue('수정한 문구\n줄바꿈 유지')
  expect(screen.getByRole('button', { name: '문구 저장' })).toBeDisabled()
  view.unmount()
})

it('저장한 문구를 서버에서 다시 확인하고 새 지문으로만 명시 승인하며 게시하지 않는다', async () => {
  const writes: Array<{ url: string; body: any }> = []
  let canonical = { ...draft, datasetMode: 'ACTUAL',
    mediaPreviews: [{ id: 'photo-1', url: '/api/workspaces/workspace-1/media/photo-1', width: 1080, height: 1080 }],
    channels: [{ provider: 'instagram', handle: '@service', connection: 'CONNECTED', publishPermission: 'GRANTED' }],
    costQuote: { amountKrw: 1200, source: 'SERVER_QUOTE' }, executionSurface: 'MOBILE_OK' }
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      writes.push({ url, body })
      if (url.endsWith('/revise')) {
        canonical = { ...canonical, copies: body.copies, approvalFingerprint: 'b'.repeat(64) }
        return Response.json({ success: true, draft: canonical })
      }
      return Response.json({ success: true })
    }
    return Response.json({ success: true, missionStatus: 'AWAITING_APPROVAL', draft: canonical })
  })
  const view = render(<AgentArtifactPlanCard plan={plan} missionId="mission-1" workspaceId="workspace-1" />)
  fireEvent.click(screen.getByRole('button', { name: '홍보 초안 불러오기' }))
  fireEvent.change(await screen.findByRole('textbox', { name: '인스타그램 홍보 문구' }), { target: { value: '새로 승인할 원고' } })
  fireEvent.click(screen.getByRole('button', { name: '문구 저장' }))
  await screen.findByText('문구가 저장되었습니다. 새 승인 요청에서 다시 확인해 주세요.')
  fireEvent.click(screen.getByRole('button', { name: '새 승인 내용 확인' }))
  const review = await screen.findByRole('region', { name: '수정한 초안의 정확 승인' })
  expect(review).toHaveTextContent('새로 승인할 원고')
  expect(review).toHaveTextContent('@service')
  expect(review).toHaveTextContent('기본 플랜 포함')
  expect(review).not.toHaveTextContent('1,200')
  expect(writes).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '이 내용으로 게시 요청' }))
  await screen.findByText('승인이 기록되었습니다. 외부 게시를 실행한 것은 아닙니다.')
  expect(writes).toHaveLength(2)
  expect(writes[1]).toMatchObject({ url: '/api/missions/first-post/approve', body: { missionId: 'mission-1', fingerprint: 'b'.repeat(64), isExplicitlyApproved: true } })
  expect(writes.some(write => write.url.includes('/publish'))).toBe(false)
  view.unmount()
})

it.each([
  ['사진 미리보기 누락', {}],
  ['사진 크기 미확인', { mediaPreviews: [{ id: 'photo-1', url: '/api/workspaces/workspace-1/media/photo-1', width: 0, height: 0 }] }],
])('%s이면 저장한 원고의 승인을 열지 않는다', async (_name, imageFields) => {
  let canonical = { ...draft, datasetMode: 'ACTUAL',
    channels: [{ provider: 'instagram', handle: '@service', connection: 'CONNECTED', publishPermission: 'GRANTED' }],
    costQuote: { amountKrw: 1200, source: 'SERVER_QUOTE' }, executionSurface: 'MOBILE_OK', ...imageFields }
  const writes: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      writes.push(String(input))
      canonical = { ...canonical, copies: JSON.parse(String(init.body)).copies, approvalFingerprint: 'b'.repeat(64) }
    }
    return Response.json({ success: true, missionStatus: 'AWAITING_APPROVAL', draft: canonical })
  })
  const view = render(<AgentArtifactPlanCard plan={plan} missionId="mission-1" workspaceId="workspace-1" />)
  fireEvent.click(screen.getByRole('button', { name: '홍보 초안 불러오기' }))
  const input = await screen.findByRole('textbox', { name: '인스타그램 홍보 문구' })
  fireEvent.change(input, { target: { value: '사진 확인 전 원고' } })
  fireEvent.click(screen.getByRole('button', { name: '문구 저장' }))
  await screen.findByText('문구가 저장되었습니다. 새 승인 요청에서 다시 확인해 주세요.')
  fireEvent.click(screen.getByRole('button', { name: '새 승인 내용 확인' }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('button', { name: '이 내용으로 게시 요청' })).not.toBeInTheDocument()
  expect(input).toHaveValue('사진 확인 전 원고')
  expect(writes).toEqual(['/api/missions/first-post/revise'])
  view.unmount()
})

it.each([
  ['게시 권한 미확인', { channels: [{ provider: 'instagram', handle: '@service', connection: 'CONNECTED', publishPermission: 'UNKNOWN' }] }],
  ['사진 권리 미확인', { rights: { rightsStatus: 'UNKNOWN', consentStatus: 'UNKNOWN' } }],
  ['가격 미확인', { costQuote: { amountKrw: null, source: 'UNKNOWN' } }],
])('%s이면 새 승인 명령을 보내지 않는다', async (_name, unconfirmedFields) => {
  let canonical = { ...draft, datasetMode: 'ACTUAL',
    mediaPreviews: [{ id: 'photo-1', url: '/api/workspaces/workspace-1/media/photo-1', width: 1080, height: 1080 }],
    channels: [{ provider: 'instagram', handle: '@service', connection: 'CONNECTED', publishPermission: 'GRANTED' }],
    costQuote: { amountKrw: 1200, source: 'SERVER_QUOTE' }, executionSurface: 'MOBILE_OK', ...unconfirmedFields }
  const writes: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      writes.push(String(input))
      canonical = { ...canonical, copies: JSON.parse(String(init.body)).copies, approvalFingerprint: 'b'.repeat(64) }
    }
    return Response.json({ success: true, missionStatus: 'AWAITING_APPROVAL', draft: canonical })
  })
  const view = render(<AgentArtifactPlanCard plan={plan} missionId="mission-1" workspaceId="workspace-1" />)
  fireEvent.click(screen.getByRole('button', { name: '홍보 초안 불러오기' }))
  fireEvent.change(await screen.findByRole('textbox', { name: '인스타그램 홍보 문구' }), { target: { value: '확인 대기 원고' } })
  fireEvent.click(screen.getByRole('button', { name: '문구 저장' }))
  await screen.findByText('문구가 저장되었습니다. 새 승인 요청에서 다시 확인해 주세요.')
  fireEvent.click(screen.getByRole('button', { name: '새 승인 내용 확인' }))
  const approve = await screen.findByRole('button', { name: '이 내용으로 게시 요청' })
  expect(approve).toBeDisabled()
  fireEvent.click(approve)
  expect(writes).toEqual(['/api/missions/first-post/revise'])
  view.unmount()
})

it('새 승인 조회가 다른 지문을 반환하면 승인 화면을 열지 않고 입력을 유지한다', async () => {
  let saved = false
  vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      saved = true
      const body = JSON.parse(String(init.body))
      return Response.json({ success: true, draft: { ...draft, copies: body.copies, approvalFingerprint: 'b'.repeat(64) } })
    }
    return Response.json({ success: true, missionStatus: 'AWAITING_APPROVAL', draft: { ...draft, datasetMode: 'ACTUAL', approvalFingerprint: (saved ? 'c' : 'a').repeat(64) } })
  })
  const view = render(<AgentArtifactPlanCard plan={plan} missionId="mission-1" workspaceId="workspace-1" />)
  fireEvent.click(screen.getByRole('button', { name: '홍보 초안 불러오기' }))
  const input = await screen.findByRole('textbox', { name: '인스타그램 홍보 문구' })
  fireEvent.change(input, { target: { value: '내 수정 원고' } })
  fireEvent.click(screen.getByRole('button', { name: '문구 저장' }))
  await screen.findByText('문구가 저장되었습니다. 새 승인 요청에서 다시 확인해 주세요.')
  fireEvent.click(screen.getByRole('button', { name: '새 승인 내용 확인' }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('region', { name: '수정한 초안의 정확 승인' })).not.toBeInTheDocument()
  expect(input).toHaveValue('내 수정 원고')
  view.unmount()
})

it('저장 응답의 원고가 요청과 다르면 저장 완료로 표시하거나 입력을 덮어쓰지 않는다', async () => {
  vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'POST'
    ? Response.json({ success: true, draft: { ...draft, approvalFingerprint: 'b'.repeat(64) } })
    : Response.json({ success: true, missionStatus: 'DRAFT', draft }))
  const view = render(<AgentArtifactPlanCard plan={plan} missionId="mission-1" workspaceId="workspace-1" />)
  fireEvent.click(screen.getByRole('button', { name: '홍보 초안 불러오기' }))
  const input = await screen.findByRole('textbox', { name: '인스타그램 홍보 문구' })
  fireEvent.change(input, { target: { value: '저장 요청한 원고' } })
  fireEvent.click(screen.getByRole('button', { name: '문구 저장' }))
  await screen.findByRole('alert')
  expect(input).toHaveValue('저장 요청한 원고')
  expect(screen.queryByText(/문구가 저장되었습니다/)).not.toBeInTheDocument()
  view.unmount()
})

it('미션이 바뀌면 이전 초안 입력과 늦은 조회 응답을 새 미션에 붙이지 않는다', async () => {
  let resolveDraft!: (value: Response) => void
  vi.stubGlobal('fetch', () => new Promise<Response>(resolve => { resolveDraft = resolve }))
  const view = render(<AgentArtifactPlanCard plan={plan} missionId="mission-1" workspaceId="workspace-1" />)
  fireEvent.click(screen.getByRole('button', { name: '홍보 초안 불러오기' }))
  view.rerender(<AgentArtifactPlanCard plan={plan} missionId="mission-2" workspaceId="workspace-1" />)
  resolveDraft(Response.json({ success: true, missionStatus: 'DRAFT', draft }))
  await waitFor(() => expect(screen.getByRole('button', { name: '홍보 초안 불러오기' })).toBeEnabled())
  expect(screen.queryByRole('textbox', { name: '인스타그램 홍보 문구' })).not.toBeInTheDocument()
  expect(screen.queryByText('처음 문구')).not.toBeInTheDocument()
  view.unmount()
})

it('충돌 응답은 저장 완료로 표시하지 않고 편집한 내용을 보존한다', async () => {
  vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'POST'
    ? Response.json({ error: '최신 초안을 다시 확인해 주세요.', code: 'CONCURRENT_REVISION_CONFLICT' }, { status: 409 })
    : Response.json({ success: true, missionStatus: 'DRAFT', draft }))
  const view = render(<AgentArtifactPlanCard plan={plan} missionId="mission-1" workspaceId="workspace-1" />)
  fireEvent.click(screen.getByRole('button', { name: '홍보 초안 불러오기' }))
  const input = await screen.findByRole('textbox', { name: '인스타그램 홍보 문구' })
  fireEvent.change(input, { target: { value: '보존할 수정 내용' } })
  fireEvent.click(screen.getByRole('button', { name: '문구 저장' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('최신 초안'))
  expect(input).toHaveValue('보존할 수정 내용')
  expect(screen.queryByText(/문구가 저장되었습니다/)).not.toBeInTheDocument()
  view.unmount()
})
