// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FirstPostEntry } from './first-post-entry'
import type { FirstPostMissionDraft } from '@/features/missions/conversational-first-post'

vi.mock('@/features/media/media-upload-card', () => ({ MediaUploadCard: () => <p>사진 업로드 경계</p> }))
vi.mock('./measured-asset', () => ({ useMeasuredImage: (asset: unknown) => ({ asset, status: 'measured' }) }))
const WS = '11111111-1111-4111-8111-111111111111'
const ID = '22222222-2222-4222-8222-222222222222'
const FP = 'a'.repeat(64)
const NEXT = 'b'.repeat(64)
function draft() {
  const base: FirstPostMissionDraft = {
    missionId: ID, workspaceId: WS, status: 'AWAITING_EXACT_APPROVAL', topic: '첫 인사', goal: '가게 소식',
    copies: { instagram: { caption: '처음 원고', cta: '예약 문의' }, threads: { content: '스레드 원고', cta: '문의' } },
    selectedImageIds: ['photo-1'], mediaPreviews: [{ id: 'photo-1', url: `/api/workspaces/${WS}/media/photo-1` }],
    rights: { rightsStatus: 'OWNED', consentStatus: 'NOT_APPLICABLE' }, boundVersions: { knowledgeVersion: 1, textHarnessVersion: 1, imageHarnessVersion: 1, operatingPolicyVersion: 1 },
    channels: [{ provider: 'instagram', handle: '@local' }], approvalFingerprint: FP,
    createdAt: '2026-10-25T10:00:00Z', knowledgeSnapshot: { businessName: '격리 매장' },
  }
  return { ...base,
    mediaPreviews: base.mediaPreviews!.map(media => ({ ...media, width: 800, height: 1000 })),
    channels: base.channels.map(channel => ({ ...channel, connection: 'CONNECTED', publishPermission: 'GRANTED' })),
    datasetMode: 'ACTUAL', costQuote: { amountKrw: 0, source: 'POLICY' }, executionSurface: 'MOBILE_OK',
  }
}

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
afterEach(() => { vi.restoreAllMocks(); window.history.replaceState({}, '', '/') })

describe('STEP 2 실제 Entry → save client → canonical 승인 배선', () => {
  it('편집 원문을 저장·GET readback한 뒤 같은 원문과 새 지문으로 승인한다', async () => {
    let stored = draft()
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/revise')) { const body = JSON.parse(String(init?.body)); stored = { ...stored, copies: body.copies, approvalFingerprint: NEXT }; return json({ success: true, draft: stored }) }
      if (url.endsWith('/approve')) return json({ success: true })
      return json({ success: true, missionStatus: 'AWAITING_APPROVAL', draft: stored })
    })
    render(<FirstPostEntry workspaceId={WS} initialDraft={stored} fetchImpl={fetcher as unknown as typeof fetch} />)
    const raw = '  수정한 원문\n\n두 번째 줄  '
    fireEvent.change(screen.getByLabelText('인스타그램 문구'), { target: { value: raw } })
    expect(screen.getByRole('button', { name: '이 내용 검토' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '변경 저장' }))
    await waitFor(() => expect(screen.getByText('저장됨')).toBeInTheDocument())
    const post = fetcher.mock.calls.find(([url]) => url.endsWith('/revise'))!
    expect(JSON.parse(String(post[1]?.body))).toMatchObject({ missionId: ID, expectedFingerprint: FP, copies: { instagram: { caption: raw, cta: '예약 문의' } } })
    expect(fetcher.mock.calls.some(([url]) => url.endsWith(ID))).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '이 내용 검토' }))
    expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === raw)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '이 내용으로 게시 요청' }))
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith('/approve'))).toBe(true))
    const approve = fetcher.mock.calls.find(([url]) => url.endsWith('/approve'))!
    expect(JSON.parse(String(approve[1]?.body)).fingerprint).toBe(NEXT)
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/publish'))).toBe(false)
  })

  it.each([false, true])('연결 채널 없음=%s·CTA 없는 원고도 편집 저장 후 수동 복사만 연다', async noChannels => {
    let stored = { ...draft(), channels: noChannels ? [] : [{ provider: 'instagram', handle: '@local', connection: 'NOT_CONNECTED' }], copies: { instagram: { caption: '원문' }, threads: { content: '스레드' } } }
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard })
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/revise')) { stored = { ...stored, copies: JSON.parse(String(init?.body)).copies, approvalFingerprint: NEXT }; return json({ success: true, draft: stored }) }
      return json({ success: true, missionStatus: 'AWAITING_APPROVAL', draft: stored })
    })
    render(<FirstPostEntry workspaceId={WS} initialDraft={stored} fetchImpl={fetcher as unknown as typeof fetch} />)
    fireEvent.change(screen.getByLabelText('인스타그램 문구'), { target: { value: '  직접 올릴 원문\n줄바꿈  ' } })
    expect(screen.getByRole('button', { name: '복사' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '변경 저장' }))
    await waitFor(() => expect(screen.getByText('저장됨')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '복사' }))
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('  직접 올릴 원문\n줄바꿈  '))
    expect(screen.queryByRole('button', { name: '이 내용 검토' })).toBeNull()
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/publish') || url.endsWith('/approve'))).toBe(false)
  })

  it.each(['rights', 'selectedImageIds', 'copies'])('readback의 %s가 바뀌면 저장됨·승인 승격 0이다', async field => {
    const original = draft()
    let saved = original
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/revise')) { saved = { ...original, copies: JSON.parse(String(init?.body)).copies, approvalFingerprint: NEXT }; return json({ success: true, draft: saved }) }
      return json({ success: true, missionStatus: 'AWAITING_APPROVAL', draft: { ...saved, [field]: field === 'rights' ? { rightsStatus: 'UNKNOWN' } : field === 'selectedImageIds' ? ['foreign-photo'] : original.copies } })
    })
    render(<FirstPostEntry workspaceId={WS} initialDraft={original} fetchImpl={fetcher as unknown as typeof fetch} />)
    fireEvent.change(screen.getByLabelText('인스타그램 문구'), { target: { value: '저장할 새 원문' } })
    fireEvent.click(screen.getByRole('button', { name: '변경 저장' }))
    await screen.findByRole('alert')
    expect(screen.queryByText('저장됨')).toBeNull()
    expect(screen.getByRole('button', { name: '이 내용 검토' })).toBeDisabled()
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/revise'))).toHaveLength(1)
  })

  it('가게를 전환하면 이전 가게의 입력 원문을 첫 paint부터 숨긴다', () => {
    const view = render(<FirstPostEntry workspaceId={WS} />)
    fireEvent.change(screen.getByLabelText('알릴 내용'), { target: { value: 'A 가게의 비공개 원문' } })
    view.rerender(<FirstPostEntry workspaceId="99999999-9999-4999-8999-999999999999" />)
    expect(screen.getByLabelText('알릴 내용')).toHaveValue('')
  })
  it('완료된 미션을 다시 열면 편집·승인·게시 없이 결과 조회만 제공한다', async () => {
    const fetcher = vi.fn(() => json({ success: true, missionStatus: 'PUBLISHED_VERIFIED', draft: draft() }))
    render(<FirstPostEntry workspaceId={WS} restoreMissionId={ID} fetchImpl={fetcher as unknown as typeof fetch} />)
    expect(await screen.findByRole('link', { name: '게시 결과 상세 열기' })).toBeInTheDocument()
    expect(screen.queryByLabelText('인스타그램 문구')).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('저장 요청 중 중복 터치는 POST 1회이고 실패 뒤에도 승인할 수 없다', async () => {
    let resolve!: (value: Response) => void
    const pending = new Promise<Response>(r => { resolve = r })
    const fetcher = vi.fn(() => pending)
    render(<FirstPostEntry workspaceId={WS} initialDraft={draft()} fetchImpl={fetcher as unknown as typeof fetch} />)
    fireEvent.change(screen.getByLabelText('인스타그램 문구'), { target: { value: '수정 원문' } })
    fireEvent.click(screen.getByRole('button', { name: '변경 저장' }))
    fireEvent.click(screen.getByRole('button', { name: '저장 중' }))
    expect(fetcher).toHaveBeenCalledTimes(1)
    await act(async () => resolve(await json({ code: 'CONCURRENT_REVISION_CONFLICT' }, 409)))
    expect(await screen.findByRole('alert')).toHaveTextContent('다른 곳에서')
    expect(screen.getByRole('button', { name: '이 내용 검토' })).toBeDisabled()
  })
})
