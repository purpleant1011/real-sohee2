// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FirstPostFlow, buildSaveClientArgs, consumeCopySave, isFirstPostR2Enabled } from './first-post-flow'
import { draftApprovalInput } from './draft-mapper'
import type { ApprovalReviewInput } from './approval-review'
import { OFFLINE_WRITE_COPY } from '@/features/pwa/action-guard'
import { resetPageActionGuardForTests } from '@/features/pwa/external-write'
import type { DraftDto } from './draft-mapper'

// 가드는 실제 연결 확인(probe)을 거친다. 이 테스트는 게시 흐름을 보는 것이므로
// 연결 확인은 통과로 고정하고, 오프라인 케이스는 navigator 힌트로 만든다.
vi.mock('@/features/pwa/network', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/pwa/network')>()
  return { ...actual, probeConnectivity: async () => true }
})

/** 사진 크기 측정은 jsdom 에서 끝나지 않는다(Image 로드 이벤트 없음). 상태를 직접 고정한다. */
const measure = vi.hoisted(() => ({
  status: 'measured' as 'measured' | 'measuring' | 'failed',
  attempts: [] as number[],
}))
vi.mock('./measured-asset', () => ({
  useMeasuredImage: (asset: unknown, attempt = 0) => {
    measure.attempts.push(attempt)
    if (!asset) return { asset: null, status: 'none' }
    if (measure.status === 'measured') return { asset, status: 'measured' }
    if (measure.status === 'failed') return { asset, status: 'failed' }
    return { asset: null, status: 'measuring' }
  },
}))

const full: DraftDto = {
  datasetMode: 'ACTUAL',
  missionId: 'm1',
  workspaceId: 'w1',
  copies: { instagram: { caption: '신메뉴', cta: '예약하기' }, threads: { content: '기존 스레드', cta: '문의' } },
  selectedImageIds: ['img1'],
  mediaPreviews: [{ id: 'img1', url: '/api/workspaces/w1/media/img1', width: 800, height: 1000 }],
  rights: { rightsStatus: 'OWNED', consentStatus: 'NOT_APPLICABLE' },
  channels: [{ provider: 'instagram', handle: '@shop', connection: 'CONNECTED', publishPermission: 'GRANTED' }],
  approvalFingerprint: 'fp',
  costQuote: { amountKrw: 0, source: 'SERVER_QUOTE' },
  executionSurface: 'MOBILE_OK',
}
const res = (b: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s }))

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('isFirstPostR2Enabled', () => {
  it('기본은 꺼짐, on 일 때만 켜짐', () => {
    expect(isFirstPostR2Enabled(undefined)).toBe(false)
    expect(isFirstPostR2Enabled('off')).toBe(false)
    expect(isFirstPostR2Enabled('true')).toBe(false)
    expect(isFirstPostR2Enabled('on')).toBe(true)
  })
})

describe('FirstPostFlow', () => {
  beforeEach(() => {
    setOnLine(true)
    resetPageActionGuardForTests()
    measure.status = 'measured'
    measure.attempts.length = 0
  })

  it('승인 전에는 게시 API 를 부르지 않고, 승인 뒤 버튼 한 번에만 게시한다', async () => {
    const f = vi.fn((url: string) => (url.endsWith('/approve') ? res({ success: true }) : res({ success: true, executionResult: { overallStatus: 'PARTIAL_SUCCESS', receipts: { instagram: { stage: 'PROVIDER_ACCEPTED' } } } })))
    render(<FirstPostFlow draft={full} fetchImpl={f as unknown as typeof fetch} />)
    fireEvent.click(screen.getByRole('button', { name: '이 내용 검토' }))
    expect(f).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: '이 내용으로 게시 요청' }))
    await screen.findByRole('button', { name: '지금 게시하기' })
    expect(f.mock.calls.map((c) => c[0])).toEqual(['/api/missions/first-post/approve'])
    fireEvent.click(screen.getByRole('button', { name: '지금 게시하기' }))
    await waitFor(() => expect(document.querySelector('[data-first-post-result]')).toBeTruthy())
    expect(document.querySelector('[data-state="VERIFIED"]')).toBeNull()
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('게시 응답을 못 읽으면 알 수 없음으로 두고 다시 게시 버튼은 없다', async () => {
    const f = vi.fn((url: string) => (url.endsWith('/approve') ? res({ success: true }) : Promise.reject(new Error('offline'))))
    render(<FirstPostFlow draft={full} fetchImpl={f as unknown as typeof fetch} />)
    fireEvent.click(screen.getByRole('button', { name: '이 내용 검토' }))
    fireEvent.click(await screen.findByRole('button', { name: '이 내용으로 게시 요청' }))
    fireEvent.click(await screen.findByRole('button', { name: '지금 게시하기' }))
    await waitFor(() => expect(document.querySelector('[data-first-post-result]')).toBeTruthy())
    expect(document.querySelector('[data-state="UNKNOWN"]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '지금 게시하기' })).toBeNull()
  })

  it('예시·시험 초안은 승인·게시 경로를 열지 않는다', async () => {
    const f = vi.fn(() => res({ success: true }))
    for (const mode of ['SHOWCASE_DEMO', 'TEST'] as const) {
      const { unmount } = render(<FirstPostFlow draft={{ ...full, datasetMode: mode }} fetchImpl={f as unknown as typeof fetch} />)
      expect(screen.queryByRole('button', { name: '이 내용 검토' })).toBeNull()
      expect(screen.getByText(/승인·게시로 이어지지 않아요/)).toBeTruthy()
      expect(screen.queryByRole('button', { name: '이 내용으로 게시 요청' })).toBeNull()
      unmount()
    }
    expect(f).not.toHaveBeenCalled()
  })

  it('초안에 workspaceId 가 없어도 라우트가 넘긴 값으로 실사진을 그린다', () => {
    const { workspaceId, ...noWs } = full
    void workspaceId
    render(<FirstPostFlow draft={noWs} workspaceId="w1" />)
    expect(screen.getByAltText('올릴 사진')).toBeTruthy()
  })

  it('사진 크기를 재는 동안은 사진 없음이 아니라 확인 중으로 보여 준다', () => {
    measure.status = 'measuring'
    // 서버 DTO 에 원본 크기가 없는 사진이라 브라우저가 재는 중이다.
    render(<FirstPostFlow draft={{ ...full, mediaPreviews: [{ id: 'img1', url: '/api/workspaces/w1/media/img1' }] }} />)

    expect(screen.queryByText('사진이 아직 없어요')).toBeNull()
    expect(screen.getByText('확인하는 중이에요')).toBeTruthy()
  })

  it('사진 크기를 재지 못하면 부분 상태로 알리고 다시 확인을 연다', () => {
    measure.status = 'failed'
    render(<FirstPostFlow draft={{ ...full, mediaPreviews: [{ id: 'img1', url: '/api/workspaces/w1/media/img1' }] }} />)

    // 사진은 있는데 크기를 모르는 상태다 — '사진이 아직 없어요'로 뭉개지 않는다.
    expect(screen.queryByText('사진이 아직 없어요')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('사진 크기를 확인하지 못했어요')

    fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))
    expect(measure.attempts.at(-1)).toBe(1)
  })

  it('워크스페이스를 확인할 수 없으면 실사진 대신 빈 상태를 보여준다', () => {
    const { workspaceId, ...noWs } = full
    void workspaceId
    render(<FirstPostFlow draft={noWs} />)
    expect(screen.queryByAltText('올릴 사진')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('사진을 다시 불러와야 해요')
  })

  it('확장 필드가 없는 현재 초안은 승인 CTA 가 닫혀 있다', async () => {
    const { channels, mediaPreviews, ...rest } = full
    void channels; void mediaPreviews
    render(<FirstPostFlow draft={{ ...rest, channels: [{ provider: 'instagram', handle: '@shop' }], mediaPreviews: [{ id: 'img1', url: '/api/workspaces/w1/media/img1' }] }} />)
    expect(screen.queryByRole('button', { name: '이 내용 검토' })).toBeNull()
  })

  it('오프라인이면 게시 API 를 부르지 않고 이유를 보여 준다', async () => {
    setOnLine(false)
    const f = vi.fn((url: string) =>
      url.endsWith('/approve') ? res({ success: true }) : Promise.reject(new Error('publish must not be called')),
    )
    render(<FirstPostFlow draft={full} fetchImpl={f as unknown as typeof fetch} />)
    fireEvent.click(screen.getByRole('button', { name: '이 내용 검토' }))
    fireEvent.click(await screen.findByRole('button', { name: '이 내용으로 게시 요청' }))
    fireEvent.click(await screen.findByRole('button', { name: '지금 게시하기' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(OFFLINE_WRITE_COPY))
    expect(f.mock.calls.map((c) => c[0])).toEqual(['/api/missions/first-post/approve'])
  })

  it('게시 버튼을 두 번 눌러도 게시 요청은 한 번만 나간다', async () => {
    const pending = deferred<Response>()
    const f = vi.fn((url: string) => (String(url).endsWith('/approve') ? res({ success: true }) : pending.promise))
    render(<FirstPostFlow draft={full} fetchImpl={f as unknown as typeof fetch} />)
    fireEvent.click(screen.getByRole('button', { name: '이 내용 검토' }))
    fireEvent.click(await screen.findByRole('button', { name: '이 내용으로 게시 요청' }))
    const submit = await screen.findByRole('button', { name: '지금 게시하기' })
    fireEvent.click(submit)
    fireEvent.click(submit)

    const publishCalls = () => f.mock.calls.filter(([url]) => String(url).endsWith('/publish'))
    await waitFor(() => expect(publishCalls()).toHaveLength(1))

    pending.resolve(new Response(JSON.stringify({
      success: true,
      executionResult: { overallStatus: 'PARTIAL_SUCCESS', receipts: { instagram: { stage: 'PROVIDER_ACCEPTED' } } },
    }), { status: 200 }))
    await waitFor(() => expect(document.querySelector('[data-first-post-result]')).toBeTruthy())
    expect(publishCalls()).toHaveLength(1)
  })

  it('플래그가 켜져 있어도 데이터셋 모드가 없으면(누락=모름) 초안을 열지 않고 fail-closed 로 닫는다', () => {
    const rawWithoutMode: DraftDto = { ...full, datasetMode: undefined }
    render(<FirstPostFlow draft={rawWithoutMode} />)
    expect(screen.getByRole('alert').textContent).toContain('화면 데이터를 확인하지 못했어요')
    expect(screen.queryByRole('button', { name: '이 내용 검토' })).toBeNull()
  })
})

describe('원고 저장 소비 (consumeCopySave) — 성공 오승격 금지', () => {
  const FP = 'a'.repeat(64)
  const approval = (): ApprovalReviewInput => draftApprovalInput(full, false)

  it('saved + hex 지문 + canonical 일치일 때만 SAVED 로 올리고 승인 지문을 교체한다', async () => {
    const save = vi.fn().mockResolvedValue({ kind: 'saved', newFingerprint: FP })
    const canonicalFingerprint = vi.fn().mockResolvedValue(FP)
    const before = approval()

    const out = await consumeCopySave({ save, approval: before, canonicalFingerprint })

    expect(out.kind).toBe('SAVED')
    if (out.kind !== 'SAVED') return
    expect(out.fingerprint).toBe(FP)
    expect(out.approval.serverFingerprint).toBe(FP)
    expect(out.approval.saved).toBe(true)
    // 원고가 바뀌었으므로 이전 승인은 무효 — 재승인 필요.
    expect(out.approval.approved).toBeNull()
    // 호출은 정확히 1회, 자동 재전송 없음.
    expect(save).toHaveBeenCalledTimes(1)
    expect(canonicalFingerprint).toHaveBeenCalledTimes(1)
  })

  it('canonical 재조회 지문이 다르면 저장 성공으로 올리지 않는다', async () => {
    const save = vi.fn().mockResolvedValue({ kind: 'saved', newFingerprint: FP })
    const canonicalFingerprint = vi.fn().mockResolvedValue('b'.repeat(64))
    const before = approval()

    const out = await consumeCopySave({ save, approval: before, canonicalFingerprint })

    expect(out.kind).toBe('NOT_SAVED')
    if (out.kind !== 'NOT_SAVED') return
    expect(out.reason).toBe('FINGERPRINT_MISMATCH')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('saved 라도 지문이 SHA-256 hex 가 아니면 성공으로 승격하지 않는다', async () => {
    const save = vi.fn().mockResolvedValue({ kind: 'saved', newFingerprint: 'not-a-hex' })
    const out = await consumeCopySave({ save, approval: approval() })

    expect(out.kind).toBe('NOT_SAVED')
    if (out.kind !== 'NOT_SAVED') return
    expect(out.reason).toBe('UNKNOWN')
  })

  it('conflict 는 STALE_APPROVAL 로 닫고 자동 재 POST 하지 않는다', async () => {
    const save = vi.fn().mockResolvedValue({ kind: 'conflict', latestDraft: { missionId: 'x' } })
    const out = await consumeCopySave({ save, approval: approval() })

    expect(out.kind).toBe('NOT_SAVED')
    if (out.kind !== 'NOT_SAVED') return
    expect(out.reason).toBe('STALE_APPROVAL')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('invalid 는 네트워크/unknown 문구와 분리해 안내한다 (서버 호출 0일 수 있음)', async () => {
    const save = vi.fn().mockResolvedValue({ kind: 'invalid' })
    const out = await consumeCopySave({ save, approval: approval() })
    const unknown = await consumeCopySave({ save: vi.fn().mockResolvedValue({ kind: 'unknown' }), approval: approval() })

    expect(out.kind).toBe('NOT_SAVED')
    if (out.kind !== 'NOT_SAVED' || unknown.kind !== 'NOT_SAVED') return
    expect(out.reason).toBe('INVALID')
    expect(unknown.reason).toBe('UNKNOWN')
    expect(out.message).not.toBe(unknown.message)
  })

  it('권한 실패(unauthorized)는 성공 배지 0 이고 승인 입력을 바꾸지 않는다', async () => {
    const save = vi.fn().mockResolvedValue({ kind: 'unauthorized' })
    const before = approval()
    const out = await consumeCopySave({ save, approval: before })

    expect(out.kind).toBe('NOT_SAVED')
    if (out.kind !== 'NOT_SAVED') return
    expect(out.reason).toBe('UNAUTHORIZED')
    expect(before.serverFingerprint).toBe(draftApprovalInput(full, false).serverFingerprint)
    expect(before.saved).toBe(false)
  })

  it('unknown 은 성공 배지 0 이고 재시도 루프를 만들지 않는다', async () => {
    const save = vi.fn().mockResolvedValue({ kind: 'unknown', reason: '서버 오류 (500)' })
    const out = await consumeCopySave({ save, approval: approval() })

    expect(out.kind).toBe('NOT_SAVED')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('save 가 던지면 UNKNOWN 으로 닫고 재시도하지 않는다', async () => {
    const save = vi.fn().mockRejectedValue(new Error('boom'))
    const out = await consumeCopySave({ save, approval: approval() })

    expect(out.kind).toBe('NOT_SAVED')
    if (out.kind !== 'NOT_SAVED') return
    expect(out.reason).toBe('UNKNOWN')
    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('buildSaveClientArgs — 서버가 준 값만 넘긴다 (가짜 draft 생성 0)', () => {
  const withSaveFields = {
    ...full,
    approvalFingerprint: 'a'.repeat(64),
    status: 'AWAITING_EXACT_APPROVAL' as const,
    topic: '신메뉴',
    goal: '첫 게시',
    boundVersions: { knowledge: 1, textHarness: 2, imageHarness: 3, policy: 4 },
    createdAt: '2026-10-24T00:00:00.000Z',
  }
  const copies = { instagram: { caption: '신메뉴', cta: '예약하기' } }

  it('서버가 준 5필드가 모두 있으면 값을 그대로 넘긴다', () => {
    const args = buildSaveClientArgs(withSaveFields, copies)
    expect(args).not.toBeNull()
    if (!args) return
    expect(args.missionId).toBe(withSaveFields.missionId)
    expect(args.workspaceId).toBe(withSaveFields.workspaceId)
    expect(args.approvalFingerprint).toBe(withSaveFields.approvalFingerprint)
    expect(args.selectedImageIds).toEqual(withSaveFields.selectedImageIds)
    expect(args.copies).toBe(copies)
    // 값 가공·생성 없이 그대로 전달
    expect(args.status).toBe('AWAITING_EXACT_APPROVAL')
    expect(args.topic).toBe('신메뉴')
    expect(args.goal).toBe('첫 게시')
    expect(args.boundVersions).toEqual(withSaveFields.boundVersions)
    expect(args.createdAt).toBe('2026-10-24T00:00:00.000Z')
  })

  it('필수 필드가 하나라도 없으면 null — 저장을 시작하지 않는다', () => {
    const { createdAt, ...noCreatedAt } = withSaveFields
    void createdAt
    expect(buildSaveClientArgs(noCreatedAt, copies)).toBeNull()

    const { boundVersions, ...noBound } = withSaveFields
    void boundVersions
    expect(buildSaveClientArgs(noBound, copies)).toBeNull()

    // 지문 형식이 틀려도 만들지 않는다.
    expect(buildSaveClientArgs({ ...withSaveFields, approvalFingerprint: 'fp' }, copies)).toBeNull()
  })
})

describe('실 UI 저장 배선 — 편집 → 저장 클릭 → port 호출 → canonical 일치 후에만 SAVED', () => {
  const FP = 'a'.repeat(64)
  const editCaption = (text: string) => {
    const areas = document.querySelectorAll('textarea')
    const area = areas[0]
    fireEvent.change(area, { target: { value: text } })
  }

  it('port 가 없으면 편집·저장 조작 없이 서버 초안의 기존 저장 상태를 유지한다', () => {
    render(<FirstPostFlow draft={full} />)
    expect(screen.queryByRole('button', { name: '변경 저장' })).toBeNull()
    expect(screen.queryByLabelText('인스타그램 문구')).toBeNull()
    expect(screen.getByText('저장됨')).toBeInTheDocument()
  })

  it('편집하면 저장 대기로 내려가고 그때 저장 버튼이 열린다', () => {
    const onSaveCopy = vi.fn()
    render(<FirstPostFlow draft={full} onSaveCopy={onSaveCopy} />)
    editCaption('고친 문구')
    expect(screen.getByRole('button', { name: '변경 저장' })).toBeTruthy()
    expect(screen.getByText('저장 안 됨')).toBeTruthy()
    expect(screen.queryByText('저장됨')).toBeNull()
  })

  it('저장 클릭 → port 1회 · 전체 canonical 일치 후 SAVED 표시', async () => {
    const onSaveCopy = vi.fn(async ({ draft, copies }) => ({ kind: 'saved', newFingerprint: FP, draft: { ...draft, copies, approvalFingerprint: FP } }))
    const readCanonicalFingerprint = vi.fn().mockResolvedValue(FP)
    render(<FirstPostFlow draft={full} onSaveCopy={onSaveCopy} readCanonicalFingerprint={readCanonicalFingerprint} />)
    editCaption('고친 문구')
    fireEvent.click(screen.getByRole('button', { name: '변경 저장' }))

    await waitFor(() => expect(screen.getByText('저장됨')).toBeTruthy())
    expect(onSaveCopy).toHaveBeenCalledTimes(1)
    expect(readCanonicalFingerprint).not.toHaveBeenCalled()
  })

  it('더블 클릭해도 저장 명령은 1회만 나간다', async () => {
    const pending = deferred<{ kind: string; newFingerprint: string; draft?: DraftDto }>()
    const onSaveCopy = vi.fn().mockReturnValue(pending.promise)
    const readCanonicalFingerprint = vi.fn().mockResolvedValue(FP)
    render(<FirstPostFlow draft={full} onSaveCopy={onSaveCopy} readCanonicalFingerprint={readCanonicalFingerprint} />)
    editCaption('고친 문구')
    const btn = screen.getByRole('button', { name: '변경 저장' })
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(onSaveCopy).toHaveBeenCalledTimes(1)
    pending.resolve({ kind: 'saved', newFingerprint: FP, draft: { ...full, approvalFingerprint: FP, copies: { ...full.copies, instagram: { ...full.copies?.instagram, caption: '고친 문구' } } } })
    await waitFor(() => expect(screen.getByText('저장됨')).toBeTruthy())
  })

  it('canonical 지문이 다르면 저장됨으로 표시하지 않는다', async () => {
    const onSaveCopy = vi.fn().mockResolvedValue({ kind: 'saved', newFingerprint: FP })
    const readCanonicalFingerprint = vi.fn().mockResolvedValue('b'.repeat(64))
    render(<FirstPostFlow draft={full} onSaveCopy={onSaveCopy} readCanonicalFingerprint={readCanonicalFingerprint} />)
    editCaption('고친 문구')
    fireEvent.click(screen.getByRole('button', { name: '변경 저장' }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.queryByText('저장됨')).toBeNull()
    expect(onSaveCopy).toHaveBeenCalledTimes(1)
  })

  it('unknown/conflict 는 성공 표시 0 이고 자동 재저장하지 않는다', async () => {
    for (const kind of ['unknown', 'conflict'] as const) {
      const onSaveCopy = vi.fn().mockResolvedValue({ kind })
      const { unmount } = render(<FirstPostFlow draft={full} onSaveCopy={onSaveCopy} />)
      editCaption('고친 문구')
      fireEvent.click(screen.getByRole('button', { name: '변경 저장' }))
      await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
      expect(screen.queryByText('저장됨')).toBeNull()
      expect(onSaveCopy).toHaveBeenCalledTimes(1)
      unmount()
    }
  })
  it('저장 미연결 경로에서는 인라인 문구 편집 입력을 열지 않고(readOnly) 정직한 준비 안내 문구를 노출한다 (ANI-1787 fallback)', () => {
    render(<FirstPostFlow draft={full} />)

    // 고친 척만 하고 저장되지 않는 인라인 입력 상자는 열지 않는다
    expect(screen.queryByLabelText('인스타그램 문구')).toBeNull()
    expect(screen.queryByLabelText('행동 유도 문구')).toBeNull()

    // 대신 정직하게 원문을 텍스트(미리보기 틀 + 상세 문구)로 보여주고 '편집 화면에서 할 수 있어요' 대신 준비 중 안내를 노출한다
    expect(screen.getAllByText('신메뉴').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('예약하기').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('현재 문구 수정·저장 기능을 준비 중이에요. 지금은 원문을 확인할 수 있어요.')).toBeInTheDocument()
    expect(screen.queryByText('문구 고치기는 편집 화면에서 할 수 있어요.')).toBeNull()
  })

  it('readOnly fallback 상태에서도 기존 draft 승인 판정은 불변이며 승인 검토로 정상 진입한다', async () => {
    render(<FirstPostFlow draft={full} />)

    // 승인 검토 버튼 활성 및 클릭
    const reviewBtn = screen.getByRole('button', { name: '이 내용 검토' })
    expect(reviewBtn).not.toBeDisabled()
    fireEvent.click(reviewBtn)

    // 승인 화면으로 진입하여 기존 draft 본문이 불변으로 유지되는지 검증
    expect(await screen.findByRole('button', { name: '이 내용으로 게시 요청' })).toBeInTheDocument()
    expect(screen.getByText('신메뉴')).toBeInTheDocument()
    expect(screen.getByText('예약하기')).toBeInTheDocument()
  })
})
