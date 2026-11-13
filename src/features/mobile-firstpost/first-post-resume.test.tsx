// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { FirstPostResume, loadStoredDraft } from './first-post-resume'

const VALID_ID = '11111111-2222-4333-8444-555555555555'
const VALID_ID_2 = '22222222-3333-4444-8555-666666666666'
const res = (b: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s }))
const draft = {
  datasetMode: 'ACTUAL',
  missionId: VALID_ID,
  copies: { instagram: { caption: '글', cta: '예약' } },
  channels: [{ provider: 'instagram', handle: '@a' }],
}

function narrow(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }))
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('loadStoredDraft', () => {
  it('저장된 초안을 그대로 돌려준다 (실제 GET 스키마 호환)', async () => {
    const f = vi.fn().mockReturnValue(res({ success: true, missionStatus: 'DRAFT', draft }))
    expect(await loadStoredDraft(VALID_ID, 'ws1', f as unknown as typeof fetch)).toEqual(draft)
    expect(f).toHaveBeenCalledWith(
      `/api/missions/first-post/${VALID_ID}`,
      expect.objectContaining({ headers: { 'x-workspace-id': 'ws1' } }),
    )
  })

  it('초안 없음·형식 오류·연결 실패는 모두 null (기존 화면 유지 호환)', async () => {
    expect(await loadStoredDraft(VALID_ID, undefined, vi.fn().mockReturnValue(res({ error: 'x' }, 422)) as unknown as typeof fetch)).toBeNull()
    expect(await loadStoredDraft(VALID_ID, undefined, vi.fn().mockReturnValue(res({ error: 'x' }, 404)) as unknown as typeof fetch)).toBeNull()
    expect(await loadStoredDraft(VALID_ID, undefined, vi.fn().mockReturnValue(res({ draft: 'x' })) as unknown as typeof fetch)).toBeNull()
    expect(await loadStoredDraft(VALID_ID, undefined, vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch)).toBeNull()
  })
})

describe('FirstPostResume', () => {
  it('플래그 OFF 면 요청도 없이 기존 화면', () => {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'off')
    narrow(true)
    const f = vi.fn()
    render(
      <MobileR2Provider enabled={false}>
        <FirstPostResume missionId={VALID_ID} fetchImpl={f as unknown as typeof fetch}>
          <p>기존 화면</p>
        </FirstPostResume>
      </MobileR2Provider>,
    )
    expect(screen.getByText('기존 화면')).toBeVisible()
    expect(f).not.toHaveBeenCalled()
  })

  it('플래그 ON 이어도 화면이 넓으면 조회 없이 기존 화면을 유지한다', () => {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'on')
    narrow(false)
    const f = vi.fn()
    render(
      <MobileR2Provider enabled>
        <FirstPostResume missionId={VALID_ID} fetchImpl={f as unknown as typeof fetch}>
          <p>기존 화면</p>
        </FirstPostResume>
      </MobileR2Provider>,
    )
    expect(f).not.toHaveBeenCalled()
    expect(screen.getByText('기존 화면')).toBeVisible()
  })

  it('플래그 ON + 저장된 초안이면 R2 흐름으로 잇는다', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'on')
    narrow(true)
    render(
      <MobileR2Provider enabled>
        <FirstPostResume
          missionId={VALID_ID}
          fetchImpl={vi.fn().mockReturnValue(res({ success: true, missionStatus: 'DRAFT', draft })) as unknown as typeof fetch}
        >
          <p>기존 화면</p>
        </FirstPostResume>
      </MobileR2Provider>,
    )
    await waitFor(() => expect(document.querySelector('[data-first-post-preview]')).toBeTruthy())
    expect(screen.queryByText('기존 화면')).toBeNull()
  })

  it('플래그 ON 이어도 첫 포스팅 초안이 없으면(404) 일반 임무 기존 화면(children)을 노출한다', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'on')
    narrow(true)
    const f = vi.fn().mockReturnValue(res({ error: '없음' }, 404))
    render(
      <MobileR2Provider enabled>
        <FirstPostResume missionId={VALID_ID} fetchImpl={f as unknown as typeof fetch}>
          <p>기존 화면</p>
        </FirstPostResume>
      </MobileR2Provider>,
    )
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('기존 화면')).toBeVisible()
    expect(screen.queryByText('초안을 확인할 수 없어요')).toBeNull()
  })

  it('플래그 ON + 401 인증 세션 만료 시 구분된 오류 및 안전한 로그인 복귀 링크를 표시한다', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'on')
    narrow(true)
    const f = vi.fn().mockReturnValue(res({ error: '인증 필요' }, 401))
    render(
      <MobileR2Provider enabled>
        <FirstPostResume missionId={VALID_ID} fetchImpl={f as unknown as typeof fetch}>
          <p>기존 화면</p>
        </FirstPostResume>
      </MobileR2Provider>,
    )
    expect(await screen.findByText('로그인이 만료됐어요')).toBeVisible()
    const link = screen.getByRole('link', { name: '다시 로그인하고 이어서 보기' })
    expect(link).toBeVisible()
    expect(link.getAttribute('href')).toBe(
      `/login?next=${encodeURIComponent(`/app/missions/${VALID_ID}`)}`,
    )
    expect(screen.queryByText('기존 화면')).toBeNull()
  })

  it('플래그 ON + 403 권한 부족 시 권한 안내 오류를 표시한다', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'on')
    narrow(true)
    const f = vi.fn().mockReturnValue(res({ error: '접근 권한 없음' }, 403))
    render(
      <MobileR2Provider enabled>
        <FirstPostResume missionId={VALID_ID} fetchImpl={f as unknown as typeof fetch}>
          <p>기존 화면</p>
        </FirstPostResume>
      </MobileR2Provider>,
    )
    expect(await screen.findByText('이 내용을 볼 권한이 없어요')).toBeVisible()
    expect(screen.queryByText('기존 화면')).toBeNull()
  })

  it('플래그 ON + 오프라인 연결 실패 시 네트워크 안내를 표시한다', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'on')
    narrow(true)
    const f = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    render(
      <MobileR2Provider enabled>
        <FirstPostResume missionId={VALID_ID} fetchImpl={f as unknown as typeof fetch}>
          <p>기존 화면</p>
        </FirstPostResume>
      </MobileR2Provider>,
    )
    expect(await screen.findByText('네트워크에 연결되지 않았어요')).toBeVisible()
    expect(screen.queryByText('기존 화면')).toBeNull()
  })

  it('플래그 ON + 유효하지 않은 UUID는 fetch를 호출하지 않고 형식 오류를 표시한다', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'on')
    narrow(true)
    const f = vi.fn()
    render(
      <MobileR2Provider enabled>
        <FirstPostResume missionId="invalid-uuid" fetchImpl={f as unknown as typeof fetch}>
          <p>기존 화면</p>
        </FirstPostResume>
      </MobileR2Provider>,
    )
    expect(f).not.toHaveBeenCalled()
    expect(await screen.findByText('입력한 내용을 확인해 주세요')).toBeVisible()
  })

  it('server status가 승인/실행/완료인 경우 편집 Flow를 열지 않고 outcome 링크만 표시한다', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'on')
    narrow(true)

    for (const status of ['APPROVED', 'EXECUTING', 'PUBLISHED_VERIFIED']) {
      const f = vi.fn().mockReturnValue(res({
        success: true,
        missionStatus: status,
        draft,
      }))
      const { unmount } = render(
        <MobileR2Provider enabled>
          <FirstPostResume missionId={VALID_ID} fetchImpl={f as unknown as typeof fetch}>
            <p>기존 화면</p>
          </FirstPostResume>
        </MobileR2Provider>,
      )

      expect(await screen.findByText('게시 결과 상세 열기')).toBeVisible()
      const link = screen.getByRole('link', { name: '게시 결과 상세 열기' })
      expect(link.getAttribute('href')).toBe(`/app/outcome/${VALID_ID}`)
      // Flow 미리보기가 마운트되지 않음
      expect(document.querySelector('[data-first-post-preview]')).toBeNull()
      // 게시 성공을 단정하는 문구가 없음 (성공 주장 금지)
      expect(screen.queryByText(/게시가 성공|발행 완료되었습니다/)).toBeNull()

      unmount()
    }
  })

  it('server status가 알 수 없는 모르는 상태이면 확인 불가 안내로 fail-closed 한다', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'on')
    narrow(true)
    const f = vi.fn().mockReturnValue(res({
      success: true,
      missionStatus: 'UNKNOWN_CUSTOM_STATUS',
      draft,
    }))
    render(
      <MobileR2Provider enabled>
        <FirstPostResume missionId={VALID_ID} fetchImpl={f as unknown as typeof fetch}>
          <p>기존 화면</p>
        </FirstPostResume>
      </MobileR2Provider>,
    )
    expect(await screen.findByText('미션 상태를 확인할 수 없어요. 접근 권한이나 상태를 확인해 주세요.')).toBeVisible()
    expect(document.querySelector('[data-first-post-preview]')).toBeNull()
  })

  it('missionId가 변경되면 이전 draft를 즉시 숨기고 이전 요청을 취소한다', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'on')
    narrow(true)

    let resolveFirst: (r: Response) => void = () => {}
    const firstPromise = new Promise<Response>((resolve) => {
      resolveFirst = resolve
    })

    const draft2 = { ...draft, missionId: VALID_ID_2 }

    const f = vi.fn().mockImplementation((url: string) => {
      if (url.includes(VALID_ID)) {
        return firstPromise
      }
      return Promise.resolve(res({ success: true, missionStatus: 'DRAFT', draft: draft2 }))
    })

    const { rerender } = render(
      <MobileR2Provider enabled>
        <FirstPostResume missionId={VALID_ID} fetchImpl={f as unknown as typeof fetch}>
          <p>기존 화면</p>
        </FirstPostResume>
      </MobileR2Provider>,
    )

    // 로딩 중 표시 확인
    expect(screen.getByText('초안을 불러오는 중...')).toBeVisible()

    // missionId를 VALID_ID_2로 변경
    rerender(
      <MobileR2Provider enabled>
        <FirstPostResume missionId={VALID_ID_2} fetchImpl={f as unknown as typeof fetch}>
          <p>기존 화면</p>
        </FirstPostResume>
      </MobileR2Provider>,
    )

    // 즉시 loading 화면 (이전 draft나 화면 노출 없음)
    expect(screen.getByText('초안을 불러오는 중...')).toBeVisible()

    // 두 번째 요청 완료 후 Flow 렌더링 확인
    await waitFor(() => expect(document.querySelector('[data-first-post-preview]')).toBeTruthy())

    // 첫 번째 느린 요청이 뒤늦게 응답해도 두 번째 화면에 영향을 주지 않음
    resolveFirst(new Response(JSON.stringify({ success: true, missionStatus: 'DRAFT', draft })))
    expect(document.querySelector('[data-first-post-preview]')).toBeTruthy()
  })
})
