import { describe, expect, it, vi } from 'vitest'
import { saveFirstPostDraftCopies, type SaveFirstPostDraftCopiesParams } from './draft-save-client'
import type { FirstPostMissionDraft } from '@/features/missions/conversational-first-post'

describe('saveFirstPostDraftCopies', () => {
  const baseDraft: FirstPostMissionDraft = {
    missionId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    status: 'AWAITING_EXACT_APPROVAL',
    topic: '첫 인사',
    goal: '매장 홍보',
    copies: {
      instagram: { caption: '이전 글', cta: '이전 CTA' },
      threads: { content: '이전 스레드', cta: '이전 CTA' },
    },
    selectedImageIds: ['img-1'],
    boundVersions: {
      knowledgeVersion: 1,
      textHarnessVersion: 1,
      imageHarnessVersion: 1,
      operatingPolicyVersion: 1,
    },
    rights: {
      rightsStatus: 'OWNED',
      consentStatus: 'CONFIRMED',
    },
    channels: [],
    approvalFingerprint: 'a'.repeat(64),
    createdAt: '2026-10-25T00:00:00Z',
  }

  const newCopies: FirstPostMissionDraft['copies'] = {
    instagram: { caption: '새 인스타 글', hashtags: ['#신메뉴'], cta: '새 CTA' },
    threads: { content: '새 스레드 글', cta: '새 CTA' },
  }

  const newFingerprint = 'f'.repeat(64)

  it('1 POST -> 1 readback 성공 시 kind: "saved" 반환 (W1 { draft: revisedDraft } 봉투 호환)', async () => {
    // W1의 표준 revise route 응답 구조 { success: true, draft: { approvalFingerprint: '...' } }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        draft: {
          ...baseDraft,
          copies: newCopies,
          approvalFingerprint: newFingerprint,
        },
      }),
    })

    const readbackMock = vi.fn().mockResolvedValue({
      ...baseDraft,
      missionId: baseDraft.missionId,
      workspaceId: baseDraft.workspaceId,
      copies: newCopies,
      selectedImageIds: baseDraft.selectedImageIds,
      approvalFingerprint: newFingerprint,
    })

    const params: SaveFirstPostDraftCopiesParams = {
      draft: baseDraft,
      copies: newCopies,
      fetchImpl: fetchMock as any,
      readback: readbackMock,
    }

    const res = await saveFirstPostDraftCopies(params)
    expect(res).toMatchObject({
      kind: 'saved',
      newFingerprint,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/missions/first-post/revise',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-workspace-id': baseDraft.workspaceId,
        },
        body: JSON.stringify({
          missionId: baseDraft.missionId,
          copies: newCopies,
          expectedFingerprint: baseDraft.approvalFingerprint,
        }),
      })
    )

    expect(readbackMock).toHaveBeenCalledTimes(1)
    // readback 은 취소용 signal 을 세 번째 인자로 받는다(호환 가산).
    expect(readbackMock).toHaveBeenCalledWith(
      baseDraft.missionId,
      baseDraft.workspaceId,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('루트 직하단 approvalFingerprint가 있는 응답도 호환 처리', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        approvalFingerprint: newFingerprint,
      }),
    })

    const readbackMock = vi.fn().mockResolvedValue({
      ...baseDraft,
      missionId: baseDraft.missionId,
      workspaceId: baseDraft.workspaceId,
      copies: newCopies,
      selectedImageIds: baseDraft.selectedImageIds,
      approvalFingerprint: newFingerprint,
    })

    const res = await saveFirstPostDraftCopies({
      draft: baseDraft,
      copies: newCopies,
      fetchImpl: fetchMock as any,
      readback: readbackMock,
    })

    expect(res).toMatchObject({
      kind: 'saved',
      newFingerprint,
    })
  })

  it('fetch 지연/영구 대기 시 bounded timeout으로 중단 후 kind: "unknown", doNotRetry: true', async () => {
    const pendingFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted')
            err.name = 'AbortError'
            reject(err)
          })
        }
      })
    })

    const res = await saveFirstPostDraftCopies({
      draft: baseDraft,
      copies: newCopies,
      fetchImpl: pendingFetch as any,
      readback: vi.fn(),
      timeoutMs: 50, // 테스트용 짧은 bounded timeout
    })

    expect(res).toMatchObject({
      kind: 'unknown',
      doNotRetry: true,
      reason: expect.stringMatching(/요청 시간 초과|aborted/i),
    })
    expect(pendingFetch).toHaveBeenCalledTimes(1)
  })

  it('fetchImpl이 AbortSignal을 무시하고 영구 대기해도 bounded race로 중단 후 kind: "unknown", doNotRetry: true', async () => {
    const ignoringSignalFetch = vi.fn().mockImplementation(() => {
      return new Promise(() => {}) // signal 무시하고 영구 pending
    })

    const res = await saveFirstPostDraftCopies({
      draft: baseDraft,
      copies: newCopies,
      fetchImpl: ignoringSignalFetch as any,
      readback: vi.fn(),
      timeoutMs: 50,
    })

    expect(res).toMatchObject({
      kind: 'unknown',
      doNotRetry: true,
      reason: expect.stringMatching(/수정 요청 시간 초과/i),
    })
  })

  it('headers 도착 후 res.json()이 영구 pending이어도 bounded race로 중단 후 kind: "unknown", doNotRetry: true', async () => {
    const hangingJsonFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => new Promise(() => {}), // json() 파싱 영구 pending
    })

    const res = await saveFirstPostDraftCopies({
      draft: baseDraft,
      copies: newCopies,
      fetchImpl: hangingJsonFetch as any,
      readback: vi.fn(),
      timeoutMs: 50,
    })

    expect(res).toMatchObject({
      kind: 'unknown',
      doNotRetry: true,
      reason: expect.stringMatching(/수정 요청 시간 초과/i),
    })
  })

  it('readback 지연/영구 대기 시 bounded timeout으로 중단 후 kind: "unknown", doNotRetry: true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, approvalFingerprint: newFingerprint }),
    })

    const pendingReadback = vi.fn().mockImplementation(() => {
      return new Promise(() => {}) // 영구 대기
    })

    const res = await saveFirstPostDraftCopies({
      draft: baseDraft,
      copies: newCopies,
      fetchImpl: fetchMock as any,
      readback: pendingReadback,
      timeoutMs: 50,
    })

    expect(res).toMatchObject({
      kind: 'unknown',
      doNotRetry: true,
      reason: expect.stringMatching(/재조회 시간 초과/i),
    })
  })

  it('readback reject 시 타이머가 정상 정리되어 누수되지 않음', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, approvalFingerprint: newFingerprint }),
    })

    const failingReadback = vi.fn().mockRejectedValue(new Error('readback immediate failure'))

    const res = await saveFirstPostDraftCopies({
      draft: baseDraft,
      copies: newCopies,
      fetchImpl: fetchMock as any,
      readback: failingReadback,
      timeoutMs: 1000,
    })

    expect(res).toMatchObject({
      kind: 'unknown',
      doNotRetry: true,
      reason: '재조회 실패: readback immediate failure',
    })
  })

  it('POST 성공했으나 서버 응답의 지문이 hex SHA-256 (64자 a-f0-9)이 아니면 kind: "unknown", doNotRetry: true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        draft: { approvalFingerprint: 'invalid_sha_with_uppercase_AND_symbols!' },
      }),
    })
    const readbackMock = vi.fn()

    const res = await saveFirstPostDraftCopies({
      draft: baseDraft,
      copies: newCopies,
      fetchImpl: fetchMock as any,
      readback: readbackMock,
    })

    expect(res).toMatchObject({
      kind: 'unknown',
      doNotRetry: true,
      reason: '유효하지 않은 신규 지문 응답',
    })
    expect(readbackMock).not.toHaveBeenCalled()
  })

  it('409, 422, 401 응답 본문이 null이거나 원시값(문자열/숫자)이어도 예외 없이 안전 처리', async () => {
    // 409 body가 null
    const res409Null = await saveFirstPostDraftCopies({
      draft: baseDraft,
      copies: newCopies,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => null,
      }) as any,
      readback: vi.fn(),
    })
    expect(res409Null).toEqual({
      kind: 'conflict',
      latestDraft: undefined,
    })

    // 422 body가 원시 문자열
    const res422Str = await saveFirstPostDraftCopies({
      draft: baseDraft,
      copies: newCopies,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => 'raw string error',
      }) as any,
      readback: vi.fn(),
    })
    expect(res422Str).toEqual({
      kind: 'invalid',
      error: '유효하지 않은 요청입니다.',
    })

    // 401 body가 json 파싱 실패 (text만 내려오는 경우)
    const res401ParseFail = await saveFirstPostDraftCopies({
      draft: baseDraft,
      copies: newCopies,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => { throw new Error('invalid json') },
      }) as any,
      readback: vi.fn(),
    })
    expect(res401ParseFail).toEqual({
      kind: 'unauthorized',
      error: '권한이 없습니다.',
    })
  })

  it('POST 성공 후 readback 값과 기대값 불일치 시 kind: "unknown", doNotRetry: true (saved 0)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        draft: { approvalFingerprint: newFingerprint },
      }),
    })

    const readbackMock = vi.fn().mockResolvedValue({
      ...baseDraft,
      missionId: baseDraft.missionId,
      workspaceId: baseDraft.workspaceId,
      copies: {
        ...newCopies,
        instagram: { ...newCopies.instagram, caption: '변조된 내용' },
      },
      selectedImageIds: baseDraft.selectedImageIds,
      approvalFingerprint: newFingerprint,
    })

    const res = await saveFirstPostDraftCopies({
      draft: baseDraft,
      copies: newCopies,
      fetchImpl: fetchMock as any,
      readback: readbackMock,
    })

    expect(res).toMatchObject({
      kind: 'unknown',
      doNotRetry: true,
      reason: '저장 후 재조회 내용 불일치',
    })
    if (res.kind === 'unknown') {
      expect(res.mismatches).toContain('copies.instagram.caption')
    }
  })

  it('expectedFingerprint가 hex SHA-256이 아니면 POST 0회로 kind: "invalid"', async () => {
    const fetchMock = vi.fn()
    const readbackMock = vi.fn()

    const res = await saveFirstPostDraftCopies({
      draft: { ...baseDraft, approvalFingerprint: 'NOT-A-HEX-FINGERPRINT' },
      copies: newCopies,
      fetchImpl: fetchMock as any,
      readback: readbackMock,
    })

    expect(res).toMatchObject({ kind: 'invalid' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(readbackMock).not.toHaveBeenCalled()
  })

  it('readback 콜백에 AbortSignal 옵션을 전달한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, approvalFingerprint: newFingerprint }),
    })
    const readbackMock = vi.fn().mockResolvedValue({
      ...baseDraft,
      missionId: baseDraft.missionId,
      workspaceId: baseDraft.workspaceId,
      copies: newCopies,
      selectedImageIds: baseDraft.selectedImageIds,
      approvalFingerprint: newFingerprint,
    })

    await saveFirstPostDraftCopies({
      draft: baseDraft,
      copies: newCopies,
      fetchImpl: fetchMock as any,
      readback: readbackMock,
    })

    expect(readbackMock).toHaveBeenCalledTimes(1)
    const options = readbackMock.mock.calls[0]?.[2]
    expect(options?.signal).toBeInstanceOf(AbortSignal)
    expect(options?.signal?.aborted).toBe(false)
  })

  it('readback 영구 대기 시 timeout으로 주입 signal이 abort되고 결과는 unknown', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, approvalFingerprint: newFingerprint }),
    })
    let captured: AbortSignal | undefined
    const pendingReadback = vi.fn().mockImplementation((_m: string, _w: string, options?: { signal: AbortSignal }) => {
      captured = options?.signal
      return new Promise(() => {}) // signal 무시하고 영구 pending
    })

    const res = await saveFirstPostDraftCopies({
      draft: baseDraft,
      copies: newCopies,
      fetchImpl: fetchMock as any,
      readback: pendingReadback,
      timeoutMs: 50,
    })

    expect(res).toMatchObject({
      kind: 'unknown',
      doNotRetry: true,
      reason: expect.stringMatching(/재조회 시간 초과/i),
    })
    expect(captured?.aborted).toBe(true)
  })

  it('외부 signal(unmount) abort 시 readback이 함께 취소되고 결과는 unknown', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, approvalFingerprint: newFingerprint }),
    })
    let captured: AbortSignal | undefined
    const pendingReadback = vi.fn().mockImplementation((_m: string, _w: string, options?: { signal: AbortSignal }) => {
      captured = options?.signal
      return new Promise(() => {}) // signal 무시하고 영구 pending
    })

    const controller = new AbortController()
    const promise = saveFirstPostDraftCopies({
      draft: baseDraft,
      copies: newCopies,
      fetchImpl: fetchMock as any,
      readback: pendingReadback,
      timeoutMs: 5000,
      signal: controller.signal,
    })

    await vi.waitFor(() => expect(captured).toBeDefined())
    controller.abort()

    const res = await promise
    expect(res).toMatchObject({ kind: 'unknown', doNotRetry: true })
    expect(captured?.aborted).toBe(true)
  })

  it('이미 abort된 params.signal + 비협조 fetch/readback이어도 POST 0회, unknown(doNotRetry) — saved 승격 0', async () => {
    // signal 을 무시하고 정상 응답을 주는 비협조 구현
    const nonCooperativeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, approvalFingerprint: newFingerprint }),
    })
    const nonCooperativeReadback = vi.fn().mockResolvedValue({
      missionId: baseDraft.missionId,
      workspaceId: baseDraft.workspaceId,
      copies: newCopies,
      selectedImageIds: baseDraft.selectedImageIds,
      approvalFingerprint: newFingerprint,
    })

    const controller = new AbortController()
    controller.abort() // 진입 전에 이미 취소된 상태

    const res = await saveFirstPostDraftCopies({
      draft: baseDraft,
      copies: newCopies,
      fetchImpl: nonCooperativeFetch as any,
      readback: nonCooperativeReadback,
      signal: controller.signal,
    })

    expect(res).toMatchObject({ kind: 'unknown', doNotRetry: true })
    expect(res.kind).not.toBe('saved')
    expect(nonCooperativeFetch).not.toHaveBeenCalled() // POST 0회
    expect(nonCooperativeReadback).not.toHaveBeenCalled()
  })

  it('POST 완료 직후 readback 시작 전 abort되어도 saved 승격 0 (unknown, doNotRetry)', async () => {
    const controller = new AbortController()
    // fetch 는 정상 응답을 주되, 응답 직후(=readback 시작 전) 외부 취소를 발생시킨다.
    const fetchAbortingAfterResponse = vi.fn().mockImplementation(async () => {
      controller.abort()
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, approvalFingerprint: newFingerprint }),
      }
    })
    // signal 을 무시하고 정상(일치하는) readback 값을 주는 비협조 구현
    const nonCooperativeReadback = vi.fn().mockResolvedValue({
      missionId: baseDraft.missionId,
      workspaceId: baseDraft.workspaceId,
      copies: newCopies,
      selectedImageIds: baseDraft.selectedImageIds,
      approvalFingerprint: newFingerprint,
    })

    const res = await saveFirstPostDraftCopies({
      draft: baseDraft,
      copies: newCopies,
      fetchImpl: fetchAbortingAfterResponse as any,
      readback: nonCooperativeReadback,
      signal: controller.signal,
    })

    expect(res).toMatchObject({ kind: 'unknown', doNotRetry: true })
    expect(res.kind).not.toBe('saved')
  })
})
