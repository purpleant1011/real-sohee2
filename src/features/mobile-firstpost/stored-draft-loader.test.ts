import { describe, expect, it, vi } from 'vitest'
import { loadStoredFirstPostDraft } from './stored-draft-loader'

const VALID_ID = '11111111-2222-4333-8444-555555555555'
const OTHER_ID = '99999999-8888-4777-8666-555555555555'

function jsonRes(body: unknown, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response
}

describe('loadStoredFirstPostDraft', () => {
  it('유효하지 않은 UUID는 fetch를 호출하지 않고 invalid_id로 반환한다', async () => {
    const fetchImpl = vi.fn()
    const result = await loadStoredFirstPostDraft({ missionId: 'not-a-uuid', fetchImpl })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.kind).toBe('invalid_id')
    if (result.kind === 'invalid_id') {
      expect(result.error.title).toBe('입력한 내용을 확인해 주세요')
    }
  })

  it('x-workspace-id 헤더와 cache: no-store로 기존 GET 엔드포인트를 호출한다', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({
      success: true,
      missionStatus: 'DRAFT',
      draft: { missionId: VALID_ID, workspaceId: 'ws-1', copies: {} },
    }))

    const result = await loadStoredFirstPostDraft({
      missionId: VALID_ID,
      workspaceId: 'ws-1',
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/missions/first-post/${VALID_ID}`,
      expect.objectContaining({
        cache: 'no-store',
        headers: expect.objectContaining({ 'x-workspace-id': 'ws-1' }),
      }),
    )
    expect(result.kind).toBe('ready')
    if (result.kind === 'ready') {
      expect(result.missionStatus).toBe('DRAFT')
      expect(result.draft.missionId).toBe(VALID_ID)
    }
  })

  it('401은 session_expired로 분류된다', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ error: '인증 세션이 필요합니다.' }, 401))
    const result = await loadStoredFirstPostDraft({ missionId: VALID_ID, fetchImpl })
    expect(result.kind).toBe('session_expired')
    if (result.kind === 'session_expired') {
      expect(result.error.action).toBe('sign_in')
    }
  })

  it('403은 forbidden으로 분류된다', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ error: '접근 권한이 없습니다.' }, 403))
    const result = await loadStoredFirstPostDraft({ missionId: VALID_ID, fetchImpl })
    expect(result.kind).toBe('forbidden')
    if (result.kind === 'forbidden') {
      expect(result.error.action).toBe('ask_admin')
    }
  })

  it('404는 missing으로 분류되며 원인을 단정하지 않는 중립 문구로 fail-closed 한다', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ error: '초안을 찾을 수 없습니다.', code: 'MISSION_NOT_FOUND' }, 404))
    const result = await loadStoredFirstPostDraft({ missionId: VALID_ID, fetchImpl })
    expect(result.kind).toBe('missing')
    if (result.kind === 'missing') {
      expect(result.error.title).toBe('초안을 확인할 수 없어요')
      expect(result.error.description).toContain('접근 권한이나 상태를 확인해 주세요')
      // 없음/권한/삭제 등의 특정 원인으로 단정하지 않음
      expect(result.error.description).not.toContain('이미 삭제')
      expect(result.error.description).not.toContain('소속된 매장')
    }
  })

  it('409는 conflict로 분류된다', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ error: '재시도할 수 있는 상태가 아니에요.', code: 'INVALID_MISSION_STATE' }, 409))
    const result = await loadStoredFirstPostDraft({ missionId: VALID_ID, fetchImpl })
    expect(result.kind).toBe('conflict')
  })

  it('422는 invalid로 분류된다', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ error: 'missionId는 유효한 UUID 형식이어야 합니다.', code: 'INVALID_MISSION_UUID' }, 422))
    const result = await loadStoredFirstPostDraft({ missionId: VALID_ID, fetchImpl })
    expect(result.kind).toBe('invalid')
  })

  it('500은 error로 분류되며 retryable=true다', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ error: '초안을 불러오지 못했어요.', code: 'INTERNAL_ERROR' }, 500))
    const result = await loadStoredFirstPostDraft({ missionId: VALID_ID, fetchImpl })
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.error.retryable).toBe(true)
    }
  })

  it('AbortError는 cancelled로 분류되어 오류로 승격하지 않는다', async () => {
    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    const fetchImpl = vi.fn(async () => { throw abortErr })
    const result = await loadStoredFirstPostDraft({ missionId: VALID_ID, fetchImpl })
    expect(result.kind).toBe('cancelled')
  })

  it('네트워크 에러는 offline으로 분류된다', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const result = await loadStoredFirstPostDraft({ missionId: VALID_ID, fetchImpl })
    expect(result.kind).toBe('offline')
  })

  it('HTTP 200이라도 missionId가 요청과 불일치하면 error로 fail-closed 한다', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({
      success: true,
      missionStatus: 'DRAFT',
      draft: { missionId: OTHER_ID },
    }))
    const result = await loadStoredFirstPostDraft({ missionId: VALID_ID, fetchImpl })
    expect(result.kind).toBe('error')
  })

  it('HTTP 200이라도 workspaceId가 요청과 불일치하면 error로 차단한다', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({
      success: true,
      missionStatus: 'DRAFT',
      draft: { missionId: VALID_ID, workspaceId: 'ws-different' },
    }))
    const result = await loadStoredFirstPostDraft({ missionId: VALID_ID, workspaceId: 'ws-my', fetchImpl })
    expect(result.kind).toBe('error')
  })

  it('HTTP 200이라도 draft 객체가 없거나 shape이 깨지면 error로 fail-closed 한다', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({
      success: true,
      draft: 'not-an-object',
    }))
    const result = await loadStoredFirstPostDraft({ missionId: VALID_ID, fetchImpl })
    expect(result.kind).toBe('error')
  })

  it('HTTP 200이라도 error 봉투가 들어있으면 error로 fail-closed 한다', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({
      loadState: 'error',
      error: 'internal failure',
    }))
    const result = await loadStoredFirstPostDraft({ missionId: VALID_ID, fetchImpl })
    expect(result.kind).toBe('error')
  })

  it('HTTP 200이라도 JSON 파싱이 실패하면 error로 fail-closed 한다', async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      ok: true,
      text: async () => '<html>502 Bad Gateway</html>',
      json: async () => { throw new Error('parse error') },
    } as unknown as Response))
    const result = await loadStoredFirstPostDraft({ missionId: VALID_ID, fetchImpl })
    expect(result.kind).toBe('error')
  })

  it('초기 signal.aborted가 이미 true이면 fetch를 호출하지 않고 즉시 cancelled를 반환한다', async () => {
    const fetchImpl = vi.fn()
    const controller = new AbortController()
    controller.abort()
    const result = await loadStoredFirstPostDraft({ missionId: VALID_ID, fetchImpl, signal: controller.signal })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.kind).toBe('cancelled')
  })

  it.each(['json', 'text'] as const)('res.%s() 본문 읽기 중 AbortError 발생 시 error로 승격하지 않고 cancelled를 반환한다', async method => {
    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    const fetchImpl = vi.fn(async () => {
      if (method === 'json') {
        return {
          status: 200,
          ok: true,
          json: async () => { throw abortErr },
        } as unknown as Response
      }
      return {
        status: 200,
        ok: true,
        text: async () => { throw abortErr },
      } as unknown as Response
    })
    const result = await loadStoredFirstPostDraft({ missionId: VALID_ID, fetchImpl })
    expect(result.kind).toBe('cancelled')
  })

  it('res.json() 내부에서 abort가 일어난 뒤 정상 body를 반환해도 cancelled를 반환한다', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => {
        controller.abort()
        return {
          success: true,
          missionStatus: 'DRAFT',
          draft: { missionId: VALID_ID },
        }
      },
    } as unknown as Response))
    const result = await loadStoredFirstPostDraft({ missionId: VALID_ID, fetchImpl, signal: controller.signal })
    expect(result.kind).toBe('cancelled')
  })

  it('HTTP 200이라도 draft.missionId가 누락되었거나 UUID가 아니면 error로 차단한다', async () => {
    // missionId 누락
    const r1 = await loadStoredFirstPostDraft({
      missionId: VALID_ID,
      fetchImpl: vi.fn(async () => jsonRes({ success: true, draft: {} })),
    })
    expect(r1.kind).toBe('error')

    // missionId가 숫자이거나 문자열이 아닌 경우
    const r2 = await loadStoredFirstPostDraft({
      missionId: VALID_ID,
      fetchImpl: vi.fn(async () => jsonRes({ success: true, draft: { missionId: 12345 } })),
    })
    expect(r2.kind).toBe('error')
  })

  it('channels나 selectedImageIds, mediaPreviews 요소 shape이 부정이면 error로 차단한다', async () => {
    // channels 필드가 배열이 아님
    const r1 = await loadStoredFirstPostDraft({
      missionId: VALID_ID,
      fetchImpl: vi.fn(async () => jsonRes({
        success: true,
        draft: { missionId: VALID_ID, channels: 'not-array' },
      })),
    })
    expect(r1.kind).toBe('error')

    // channels 요소가 null 이거나 provider가 string이 아님 (crash 방지)
    const rChannelsNull = await loadStoredFirstPostDraft({
      missionId: VALID_ID,
      fetchImpl: vi.fn(async () => jsonRes({
        success: true,
        draft: { missionId: VALID_ID, channels: [null] },
      })),
    })
    expect(rChannelsNull.kind).toBe('error')

    const rChannelsBadItem = await loadStoredFirstPostDraft({
      missionId: VALID_ID,
      fetchImpl: vi.fn(async () => jsonRes({
        success: true,
        draft: { missionId: VALID_ID, channels: [{ provider: 123 }] },
      })),
    })
    expect(rChannelsBadItem.kind).toBe('error')

    // selectedImageIds 비배열 또는 요소가 string이 아님
    const rSelectedNotArray = await loadStoredFirstPostDraft({
      missionId: VALID_ID,
      fetchImpl: vi.fn(async () => jsonRes({
        success: true,
        draft: { missionId: VALID_ID, selectedImageIds: 123 },
      })),
    })
    expect(rSelectedNotArray.kind).toBe('error')

    const rSelectedBadItem = await loadStoredFirstPostDraft({
      missionId: VALID_ID,
      fetchImpl: vi.fn(async () => jsonRes({
        success: true,
        draft: { missionId: VALID_ID, selectedImageIds: [null] },
      })),
    })
    expect(rSelectedBadItem.kind).toBe('error')

    // mediaPreviews 비배열 또는 요소가 id/url string을 갖지 않음
    const rMediaNotArray = await loadStoredFirstPostDraft({
      missionId: VALID_ID,
      fetchImpl: vi.fn(async () => jsonRes({
        success: true,
        draft: { missionId: VALID_ID, mediaPreviews: 'not-array' },
      })),
    })
    expect(rMediaNotArray.kind).toBe('error')

    const rMediaBadItem = await loadStoredFirstPostDraft({
      missionId: VALID_ID,
      fetchImpl: vi.fn(async () => jsonRes({
        success: true,
        draft: { missionId: VALID_ID, mediaPreviews: [{ id: 123, url: null }] },
      })),
    })
    expect(rMediaBadItem.kind).toBe('error')
  })

  it('HTTP 200이라도 success: true와 error 봉투가 함께 존재하면 ready로 올리지 않고 error로 차단한다', async () => {
    const result = await loadStoredFirstPostDraft({
      missionId: VALID_ID,
      fetchImpl: vi.fn(async () => jsonRes({
        success: true,
        error: 'something wrong',
        draft: { missionId: VALID_ID },
      })),
    })
    expect(result.kind).toBe('error')
  })
})
