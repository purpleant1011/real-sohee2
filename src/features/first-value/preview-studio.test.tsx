import React from 'react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FirstValueStudio } from './preview-studio'
import { DUPLICATE_WRITE_COPY, OFFLINE_WRITE_COPY } from '@/features/pwa/action-guard'
import { resetPageActionGuardForTests } from '@/features/pwa/external-write'

expect.extend(matchers)

const mockPush = vi.fn()
const mockPrefetch = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    prefetch: mockPrefetch,
  }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}))
// 발행 가드는 실제 연결 확인(probe)을 거친다. 이 스위트는 발행 흐름을 보는 것이므로 probe 는
// 통과로 고정하고, 오프라인 케이스는 navigator 힌트로 만든다(ANI-1778).
const probeState = vi.hoisted(() => ({ probe: async (): Promise<boolean> => true }))
vi.mock('@/features/pwa/network', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/pwa/network')>()
  return { ...actual, probeConnectivity: () => probeState.probe() }
})

const item = { workspaceId: 'aaaaaaaa-bbbb-4aaa-8aaa-aaaaaaaaaaaa', missionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', businessName: '모모 카페', imageIds: [], imageUrl: null, copies: { threads: { content: '따뜻한 첫 인사를 전합니다.' }, instagram: { caption: '안녕하세요', hashtags: [] } }, channels: [], revision: 1, approvalFingerprint: 'reviewed-fingerprint' }
const base = { item, view: { summary: '모모 카페 · 동네 카페', action: 'VAULT', actionLabel: '승인하고 보관', message: '승인 전에는 아무것도 게시되지 않아요', contentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', progressPercent: 75 }, imageNotice: '사진을 만드는 중 문제가 생겨 글만 먼저 준비했어요.' }

describe('first-value preview studio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetPageActionGuardForTests()
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/')
    }
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
    probeState.probe = async (): Promise<boolean> => true
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  })

  afterEach(() => {
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/')
    }
  })

  it('shows the store understanding, one text preview, and replaces button with success card on save', async () => {
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.split('?')[0] === '/api/first-value' && !options?.method) return { ok: true, json: async () => base }
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({ accepted: true }) }
      if (url.endsWith('/vault')) return { ok: true, json: async () => ({ saved: [{ channel: 'threads', release_gate_label: '채널 연결을 기다리는 중 · 외부 게시 전' }], rejected: [], external_posts: 0 }) }
      throw new Error('unexpected request')
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)
    expect(await screen.findByText('사장님 가게를 이렇게 이해했어요')).toBeInTheDocument()
    expect(screen.getByText('모모 카페 · 동네 카페')).toBeInTheDocument()
    expect(screen.getByText('따뜻한 첫 인사를 전합니다.')).toBeInTheDocument()
    expect(screen.getByText('승인 전에는 아무것도 게시되지 않아요')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('글만 먼저')

    const saveButton = screen.getByRole('button', { name: '승인하고 보관' })
    fireEvent.click(saveButton)

    // 저장 성공 시 성공 카드 노출 및 포커스 이동 확인
    const successTitle = await screen.findByText('첫 글을 보관함에 담았어요')
    expect(successTitle).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '직접 전달한 내용을 기록해요' })).toBeInTheDocument()
    expect(screen.getByText(/인스타그램이나 스레드를 연결하면 사장님이 직접 확인하고 올릴 수 있어요/)).toBeInTheDocument()

    // channels가 비어 있으므로 '채널 연결하고 올리기' 노출
    const connectLink = screen.getByRole('link', { name: '채널 연결하고 올리기' })
    expect(connectLink).toHaveAttribute('href', '/start?step=channels')

    const vaultLink = screen.getByRole('link', { name: '보관함에서 보기' })
    expect(vaultLink).toHaveAttribute('href', '/app/vault')

    const toAppButton = screen.getByRole('button', { name: '소희 작업실로 이동' })
    expect(toAppButton).toBeInTheDocument()
  }, 15_000)

  it('saves inline text through the existing draft API and reloads its persisted version before approval', async () => {
    let edited = false
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.split('?')[0] === '/api/first-value') return { ok: true, json: async () => edited
        ? { ...base, item: { ...item, revision: 2, approvalFingerprint: 'v2', copies: { ...item.copies, threads: { content: '수정한 가격 50,000원' } } } }
        : base }
      if (options?.method === 'PATCH') {
        edited = true
        return { ok: true, json: async () => ({ item: { ...item, revision: 2 } }) }
      }
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({ accepted: true }) }
      throw new Error('unexpected request')
    }) as unknown as typeof fetch
    render(<FirstValueStudio fetcher={fetcher} />)
    fireEvent.click(await screen.findByRole('button', { name: '글 직접 수정' }))
    expect(screen.queryByRole('button', { name: '승인하고 보관' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '스레드 글' }), { target: { value: '수정한 가격 50,000원' } })
    fireEvent.click(screen.getByRole('button', { name: '수정 내용 저장' }))
    expect(await screen.findByRole('button', { name: '승인하고 보관' })).toBeInTheDocument()
    expect(screen.getByText('수정한 가격 50,000원')).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledWith(`/api/workspaces/${item.workspaceId}/quick-post`, expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ missionId: item.missionId, scope: 'text', copies: { ...item.copies, threads: { content: '수정한 가격 50,000원' } } }),
    }))
  })

  it('explicitly adds the saved booking destination through the persisted draft edit flow', async () => {
    const href = 'https://booking.example.com/shop-a'
    let edited = false
    let patch: any = null
    let completePatch: () => void = () => undefined
    const patchDone = new Promise<void>(resolve => { completePatch = resolve })
    const copies = { instagram: { ...item.copies.instagram, caption: `${item.copies.instagram.caption}\n\n${href}` }, threads: { content: `${item.copies.threads.content}\n\n${href}` } }
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.split('?')[0] === '/api/first-value') return { ok: true, json: async () => edited ? { ...base, item: { ...item, revision: 2, copies, approvalFingerprint: 'v2' } } : base }
      if (url === '/api/first-value/destination') return { ok: true, json: async () => ({ configuration: { revision: 1, bookingUrl: href, bookingExpiresAt: null }, destination: { kind: 'BOOKING_URL', href, label: '사장님이 확인한 예약 링크', networkVerified: false } }) }
      if (options?.method === 'PATCH') { patch = JSON.parse(String(options.body)); await patchDone; edited = true; return { ok: true, json: async () => ({ item: { ...item, revision: 2 } }) } }
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({ accepted: true }) }
      throw new Error('Unexpected request')
    }) as unknown as typeof fetch
    render(<FirstValueStudio fetcher={fetcher} />)
    fireEvent.click(await screen.findByRole('button', { name: '예약 링크 설정' }))
    fireEvent.click(await screen.findByRole('button', { name: '이 주소를 글에 추가' }))
    expect(await screen.findByText('예약 주소를 원고에 저장하고 있어요.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '승인하고 보관' })).not.toBeInTheDocument()
    completePatch()
    expect(await screen.findByRole('button', { name: '승인하고 보관' })).toBeInTheDocument()
    expect(patch?.copies).toEqual(copies)
    expect(await screen.findByText((text) => text.includes(href) && text.includes('따뜻한 첫 인사'))).toBeInTheDocument()
    expect((fetcher as any).mock.calls.some(([url]: [string]) => url === '/api/first-value/publish')).toBe(false)
  })

  it('reloads a stale approval instead of blindly resending it', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.split('?')[0] === '/api/first-value') return { ok: true, json: async () => ({ ...base, view: { ...base.view, action: 'PUBLISH', actionLabel: '승인하고 발행' } }) }
      if (url === '/api/first-value/publish') return { ok: false, status: 409, json: async () => ({ error: '글이 변경되었어요.', code: 'STALE_DRAFT' }) }
      return { ok: true, json: async () => ({ accepted: true }) }
    }) as unknown as typeof fetch
    render(<FirstValueStudio fetcher={fetcher} />)
    fireEvent.click(await screen.findByRole('button', { name: '승인하고 발행' }))
    fireEvent.click(screen.getByRole('button', { name: '네, 발행할게요' }))
    fireEvent.click(await screen.findByRole('button', { name: '최신 내용 다시 확인' }))
    expect(await screen.findByRole('button', { name: '승인하고 발행' })).toBeInTheDocument()
    expect((fetcher as any).mock.calls.filter(([url]: [string]) => url === '/api/first-value/publish')).toHaveLength(1)
  })

  it('confirms copying only after the clipboard succeeds and never reports a publication', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => base })) as unknown as typeof fetch
    render(<FirstValueStudio fetcher={fetcher} />)
    fireEvent.click(await screen.findByRole('button', { name: '글 복사' }))
    expect(await screen.findByRole('status', { name: '수동 게시 준비 상태' })).toHaveTextContent('글을 복사했어요. 직접 올리기 전이며 게시 여부는 확인되지 않았어요.')
    expect(writeText).toHaveBeenCalledWith(item.copies.threads.content)
    expect(screen.queryByText(/즉시 발행돼요/)).not.toBeInTheDocument()
    expect(screen.queryByText(/600 크레딧 지급/)).not.toBeInTheDocument()
    expect(screen.queryByText('첫 게시물이 올라갔어요')).not.toBeInTheDocument()
    expect((fetcher as any).mock.calls.some(([url]: [string]) => url === '/api/first-value/publish')).toBe(false)
  })

  it('does not claim a copy when clipboard access fails', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => base })) as unknown as typeof fetch
    render(<FirstValueStudio fetcher={fetcher} />)
    fireEvent.click(await screen.findByRole('button', { name: '글 복사' }))
    expect(await screen.findByText('복사하지 못했어요. 글을 길게 눌러 직접 복사해 주세요.')).toBeInTheDocument()
    expect(screen.queryByText('글을 복사했어요. 직접 올리기 전이며 게시 여부는 확인되지 않았어요.')).not.toBeInTheDocument()
  })

  it('shows saving spinner while save request is in flight', async () => {
    let resolveSave: (val: any) => void = () => {}
    const savePromise = new Promise((resolve) => {
      resolveSave = resolve
    })

    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.split('?')[0] === '/api/first-value' && !options?.method) return { ok: true, json: async () => base }
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({ accepted: true }) }
      if (url.endsWith('/vault')) {
        await savePromise
        return { ok: true, json: async () => ({ saved: [{ channel: 'threads' }], rejected: [], external_posts: 0 }) }
      }
      throw new Error('unexpected request')
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)
    const saveButton = await screen.findByRole('button', { name: '승인하고 보관' })
    fireEvent.click(saveButton)

    // 즉시 '보관하는 중…' 및 aria-busy 확인
    expect(screen.getByRole('button', { name: /보관하는 중…/ })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: /보관하는 중…/ })).toBeDisabled()

    resolveSave(true)
    expect(await screen.findByText('첫 글을 보관함에 담았어요')).toBeInTheDocument()
  })

  it('renders "바로 올려보기" button in success card when channels are connected', async () => {
    const connectedBase = {
      ...base,
      item: {
        ...base.item,
        channels: [{ provider: 'threads', handle: 'momo_cafe' }],
      },
    }

    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.split('?')[0] === '/api/first-value' && !options?.method) return { ok: true, json: async () => connectedBase }
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({ accepted: true }) }
      if (url.endsWith('/vault')) return { ok: true, json: async () => ({ saved: [{ channel: 'threads' }], rejected: [], external_posts: 0 }) }
      throw new Error('unexpected request')
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)
    fireEvent.click(await screen.findByRole('button', { name: '승인하고 보관' }))

    expect(await screen.findByText('첫 글을 보관함에 담았어요')).toBeInTheDocument()
    const publishDirectlyBtn = screen.getByRole('button', { name: '바로 올려보기' })
    expect(publishDirectlyBtn).toBeInTheDocument()

    // 클릭 시 confirmPublish 확인 다이얼로그 노출
    fireEvent.click(publishDirectlyBtn)
    expect(screen.getByText('발행은 연결된 채널에 실제로 올라가요. 계속할까요?')).toBeInTheDocument()
  })

  it('renders error card with retry button on save failure', async () => {
    let saveAttempts = 0
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.split('?')[0] === '/api/first-value' && !options?.method) return { ok: true, json: async () => base }
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({ accepted: true }) }
      if (url.endsWith('/vault')) {
        saveAttempts++
        if (saveAttempts === 1) {
          return { ok: false, status: 500, json: async () => ({ error: '네트워크 장애' }) }
        }
        return { ok: true, json: async () => ({ saved: [{ channel: 'threads' }], rejected: [], external_posts: 0 }) }
      }
      throw new Error('unexpected request')
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)
    fireEvent.click(await screen.findByRole('button', { name: '승인하고 보관' }))

    // 실패 카드 렌더링 확인
    expect(await screen.findByText('잠시 문제가 생겼어요')).toBeInTheDocument()
    const retryBtn = screen.getByRole('button', { name: '다시 시도' })
    fireEvent.click(retryBtn)

    expect(await screen.findByText('첫 글을 보관함에 담았어요')).toBeInTheDocument()
  })

  it('requires an explicit publish confirmation for a server-approved publish action and shows celebration card', async () => {
    const fetcher = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => {
        if (url.split('?')[0] === '/api/first-value') return { ...base, view: { ...base.view, action: 'PUBLISH', actionLabel: '승인하고 발행' } }
        if (url === '/api/onboarding/funnel') return { accepted: true }
        if (url === '/api/first-value/publish') return { verified: true, permalink: 'https://threads.net/@momo/123', channel: 'threads' }
        return { ok: true }
      },
    })) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)
    fireEvent.click(await screen.findByRole('button', { name: '승인하고 발행' }))
    expect(screen.getByText('발행은 연결된 채널에 실제로 올라가요. 계속할까요?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '네, 발행할게요' }))
    expect(await screen.findByText('첫 게시물이 올라갔어요')).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledWith('/api/first-value/publish', expect.objectContaining({
      body: JSON.stringify({ missionId: item.missionId, revision: item.revision, fingerprint: item.approvalFingerprint, reviewedImageIds: item.imageIds }),
    }))
    expect(screen.getByText('게시물 보기')).toHaveAttribute('href', 'https://threads.net/@momo/123')
    expect(screen.getByRole('button', { name: '소희 작업실로 이동' })).toBeInTheDocument()

    // 카운트다운 취소 버튼 동작
    const cancelCountdownBtn = await screen.findByRole('button', { name: '이동하지 않기' })
    fireEvent.click(cancelCountdownBtn)
    expect(screen.queryByText(/초 후 소희 작업실로 이동해요/)).not.toBeInTheDocument()
  })

  it('오프라인이면 발행 확인을 눌러도 요청을 보내지 않는다 (ANI-1778)', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.split('?')[0] === '/api/first-value') return { ok: true, json: async () => ({ ...base, view: { ...base.view, action: 'PUBLISH', actionLabel: '승인하고 발행' } }) }
      if (url === '/api/first-value/publish') return { ok: true, json: async () => ({ verified: true, permalink: 'https://threads.net/@momo/123', channel: 'threads' }) }
      return { ok: true, json: async () => ({ accepted: true }) }
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)
    fireEvent.click(await screen.findByRole('button', { name: '승인하고 발행' }))

    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false })
    fireEvent.click(screen.getByRole('button', { name: '네, 발행할게요' }))

    expect(await screen.findByText(OFFLINE_WRITE_COPY)).toBeInTheDocument()
    expect((fetcher as any).mock.calls.some(([url]: [string]) => url === '/api/first-value/publish')).toBe(false)
  })

  it('발행 확인을 연달아 눌러도 외부 요청은 한 번만 나간다 (ANI-1778)', async () => {
    // 연결 확인(probe)이 끝나기 전의 두 번째 클릭을 재현한다. 이 구간에서는 아직 '발행 중' 상태가
    // 아니므로 화면 상태만으로는 막히지 않고, 외부 쓰기 가드가 두 번째 요청을 막아야 한다.
    let releaseProbe!: (value: boolean) => void
    probeState.probe = () => new Promise<boolean>((resolve) => { releaseProbe = resolve })

    const fetcher = vi.fn(async (url: string) => {
      if (url.split('?')[0] === '/api/first-value') return { ok: true, json: async () => ({ ...base, view: { ...base.view, action: 'PUBLISH', actionLabel: '승인하고 발행' } }) }
      if (url === '/api/first-value/publish') return { ok: true, json: async () => ({ verified: true, permalink: 'https://threads.net/@momo/123', channel: 'threads' }) }
      return { ok: true, json: async () => ({ accepted: true }) }
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)
    fireEvent.click(await screen.findByRole('button', { name: '승인하고 발행' }))
    const confirm = screen.getByRole('button', { name: '네, 발행할게요' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(await screen.findByText(DUPLICATE_WRITE_COPY)).toBeInTheDocument()
    expect((fetcher as any).mock.calls.some(([url]: [string]) => url === '/api/first-value/publish')).toBe(false)

    // 첫 요청은 연결 확인이 끝난 뒤 정상적으로 한 번만 나간다.
    await act(async () => {
      releaseProbe(true)
    })
    expect((fetcher as any).mock.calls.filter(([url]: [string]) => url === '/api/first-value/publish')).toHaveLength(1)
  })

  it('연결 확인을 기다리는 동안 발행을 취소하면 확인이 끝나도 게시 요청을 보내지 않는다 (ANI-1778)', async () => {
    // 확인(probe)이 늦게 끝나는 사이 '나중에 할게요'를 누르는 경합을 재현한다.
    // 확인 패널의 취소는 그 시점에 예약된 발행까지 무효화해야 한다.
    const probeResolvers: Array<(value: boolean) => void> = []
    probeState.probe = () => new Promise<boolean>((resolve) => { probeResolvers.push(resolve) })

    const fetcher = vi.fn(async (url: string) => {
      if (url.split('?')[0] === '/api/first-value') return { ok: true, json: async () => ({ ...base, view: { ...base.view, action: 'PUBLISH', actionLabel: '승인하고 발행' } }) }
      if (url === '/api/first-value/publish') return { ok: true, json: async () => ({ verified: true, permalink: 'https://threads.net/@momo/123', channel: 'threads' }) }
      return { ok: true, json: async () => ({ accepted: true }) }
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)
    fireEvent.click(await screen.findByRole('button', { name: '승인하고 발행' }))
    fireEvent.click(screen.getByRole('button', { name: '네, 발행할게요' }))
    fireEvent.click(screen.getByRole('button', { name: '나중에 할게요' }))

    expect(screen.queryByRole('alertdialog', { name: '발행 확인' })).not.toBeInTheDocument()

    await act(async () => {
      probeResolvers[0]?.(true)
    })
    expect((fetcher as any).mock.calls.some(([url]: [string]) => url === '/api/first-value/publish')).toBe(false)

    // 취소가 이후 발행을 영구히 막지는 않는다 — 다시 확인하면 정상적으로 한 번 나간다.
    fireEvent.click(screen.getByRole('button', { name: '승인하고 발행' }))
    fireEvent.click(screen.getByRole('button', { name: '네, 발행할게요' }))
    await act(async () => {
      probeResolvers[1]?.(true)
    })
    expect((fetcher as any).mock.calls.filter(([url]: [string]) => url === '/api/first-value/publish')).toHaveLength(1)
  })

  it('disables auto countdown when prefers-reduced-motion is true', async () => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    const fetcher = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => {
        if (url.split('?')[0] === '/api/first-value') return { ...base, view: { ...base.view, action: 'PUBLISH', actionLabel: '승인하고 발행' } }
        if (url === '/api/onboarding/funnel') return { accepted: true }
        if (url === '/api/first-value/publish') return { verified: true, permalink: null, channel: 'threads' }
        return { ok: true }
      },
    })) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)
    fireEvent.click(await screen.findByRole('button', { name: '승인하고 발행' }))
    fireEvent.click(screen.getByRole('button', { name: '네, 발행할게요' }))

    expect(await screen.findByText('첫 게시물이 올라갔어요')).toBeInTheDocument()
    expect(screen.queryByText(/초 후 소희 작업실로 이동해요/)).not.toBeInTheDocument()
  })

  it('renders error card with retry button on server failure and retries successfully', async () => {
    let callCount = 0
    const fetcher = vi.fn(async (url: string) => {
      if (url.split('?')[0] === '/api/first-value') {
        callCount++
        if (callCount === 1) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ error: '일시적인 연결 지연이 발생했어요.', code: 'CREDIT_RESERVE_FAILED' }),
          }
        }
        return { ok: true, json: async () => base }
      }
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({ accepted: true }) }
      throw new Error('unexpected request')
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)
    expect(await screen.findByText('잠시 문제가 생겼어요')).toBeInTheDocument()
    const retryBtn = screen.getByRole('button', { name: '다시 시도' })
    fireEvent.click(retryBtn)
    expect(await screen.findByText('사장님 가게를 이렇게 이해했어요')).toBeInTheDocument()
  })

  it('returns to explicit photo selection instead of retrying generation after MEDIA_SELECTION_REQUIRED', async () => {
    const fetcher = vi.fn(async () => Response.json({ error: '사진을 골라 주세요.', code: 'MEDIA_SELECTION_REQUIRED', actionHref: '/start' }, { status: 409 })) as unknown as typeof fetch
    render(<FirstValueStudio fetcher={fetcher} />)
    expect(await screen.findByRole('link', { name: '사진 다시 고르기' })).toHaveAttribute('href', '/start')
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('renders credit shortage error card when server responds with 402 INSUFFICIENT_CREDITS', async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 402,
      json: async () => ({
        error: '사장님 크레딧이 부족해요.',
        code: 'INSUFFICIENT_CREDITS',
      }),
    })) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)
    expect(await screen.findByText('첫 포스팅에 쓸 포인트가 없어요')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '채널 연결하기' })).toHaveAttribute('href', '/start?step=channels')
    expect(screen.getByRole('link', { name: '사업자 인증하기' })).toHaveAttribute('href', '/onboarding/business')
  })

  it('single phase: hides confirmation dialog and saved card when publish fails, rendering only error card', async () => {
    const connectedBase = {
      ...base,
      item: {
        ...base.item,
        channels: [{ provider: 'threads', handle: 'momo_cafe' }],
      },
    }

    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.split('?')[0] === '/api/first-value' && !options?.method) return { ok: true, json: async () => connectedBase }
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({ accepted: true }) }
      if (url.endsWith('/vault')) return { ok: true, json: async () => ({ saved: [{ channel: 'threads' }], rejected: [], external_posts: 0 }) }
      if (url === '/api/first-value/publish') {
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: '채널 연결 상태를 확인하지 못했어요.', code: 'CHANNEL_NOT_VERIFIED' }),
        }
      }
      throw new Error('unexpected request')
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)

    // 1. 보관 먼저 진행
    fireEvent.click(await screen.findByRole('button', { name: '승인하고 보관' }))
    expect(await screen.findByText('첫 글을 보관함에 담았어요')).toBeInTheDocument()

    // 2. '바로 올려보기' 클릭 -> 확인 다이얼로그 노출
    fireEvent.click(screen.getByRole('button', { name: '바로 올려보기' }))
    expect(screen.getByText('발행은 연결된 채널에 실제로 올라가요. 계속할까요?')).toBeInTheDocument()

    // 3. '네, 발행할게요' 클릭 -> 발행 실패 발생
    fireEvent.click(screen.getByRole('button', { name: '네, 발행할게요' }))

    // 4. 단일 phase 검증: 에러 카드만 렌더되고 확인 다이얼로그와 보관 완료 카드는 숨겨짐!
    expect(await screen.findByText('채널 확인이 필요해요')).toBeInTheDocument()
    expect(screen.queryByText('발행은 연결된 채널에 실제로 올라가요. 계속할까요?')).not.toBeInTheDocument()
    expect(screen.queryByText('첫 글을 보관함에 담았어요')).not.toBeInTheDocument()
    expect(screen.queryByText('첫 게시물이 올라갔어요')).not.toBeInTheDocument()
  })

  it('publish failure with PUBLISH_NOT_ENABLED renders guidance and provides vault fallback action', async () => {
    const publishReadyBase = {
      ...base,
      view: {
        ...base.view,
        action: 'PUBLISH' as const,
        actionLabel: '승인하고 발행' as const,
      },
    }

    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.split('?')[0] === '/api/first-value' && !options?.method) return { ok: true, json: async () => publishReadyBase }
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({ accepted: true }) }
      if (url === '/api/first-value/publish') {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            error: '게시 기능을 준비하고 있어요. 글은 보관함에 안전하게 담아 둘게요.',
            code: 'PUBLISH_NOT_ENABLED',
          }),
        }
      }
      if (url.endsWith('/vault')) {
        return { ok: true, json: async () => ({ saved: [{ channel: 'threads' }], rejected: [], external_posts: 0 }) }
      }
      throw new Error('unexpected request')
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)

    // '승인하고 발행' 클릭
    fireEvent.click(await screen.findByRole('button', { name: '승인하고 발행' }))
    // '네, 발행할게요' 클릭
    fireEvent.click(screen.getByRole('button', { name: '네, 발행할게요' }))

    // PUBLISH_NOT_ENABLED 에러 카드 확인
    expect(await screen.findByText('게시 기능을 준비하고 있어요')).toBeInTheDocument()
    expect(screen.getByText(/글은 보관함에 안전하게 담아 둘게요/)).toBeInTheDocument()

    // 보관함에 담기 (vault fallback) 클릭
    const vaultActionBtn = screen.getByRole('button', { name: '보관함에 담기' })
    fireEvent.click(vaultActionBtn)

    // 보관 완료 카드로 단일 phase 전환 확인
    expect(await screen.findByText('첫 글을 보관함에 담았어요')).toBeInTheDocument()
    expect(screen.queryByText('게시 기능을 준비하고 있어요')).not.toBeInTheDocument()
  })

  it('renders dual channel tabs when both Instagram and Threads are connected, allowing switching preview', async () => {
    const dualBase = {
      ...base,
      item: {
        ...base.item,
        channels: [
          { provider: 'instagram', handle: 'momo_insta' },
          { provider: 'threads', handle: 'momo_threads' },
        ],
        imageUrl: 'https://example.com/test.jpg',
        copies: {
          instagram: { caption: '인스타그램용 감성 피드 캡션입니다.', hashtags: ['카페', '일상'] },
          threads: { content: '스레드용 빠른 첫 소식입니다.' },
        },
      },
      view: {
        ...base.view,
        action: 'PUBLISH' as const,
        actionLabel: '승인하고 발행' as const,
        targetChannelsText: '인스타그램 · 스레드에 올려요',
        targetChannels: ['instagram', 'threads'],
      },
    }

    const fetcher = vi.fn(async (url: string) => {
      if (url.split('?')[0] === '/api/first-value') return { ok: true, json: async () => dualBase }
      throw new Error('unexpected request')
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)

    // Tab buttons exist
    const instaTab = await screen.findByRole('tab', { name: '인스타그램' })
    const threadsTab = screen.getByRole('tab', { name: '스레드' })
    expect(instaTab).toBeInTheDocument()
    expect(threadsTab).toBeInTheDocument()

    // Default tab is threads
    expect(screen.getByText('스레드용 빠른 첫 소식입니다.')).toBeInTheDocument()

    // Click Instagram tab
    fireEvent.click(instaTab)
    expect(await screen.findByText('인스타그램용 감성 피드 캡션입니다.')).toBeInTheDocument()

    // Main button has dual channel text
    expect(screen.getByRole('button', { name: '승인하고 발행 · 인스타그램 · 스레드에 올려요' })).toBeInTheDocument()
  })

  it('renders celebratory card with per-channel badges and retry button for failed channel on partial success', async () => {
    const dualPublishBase = {
      ...base,
      item: {
        ...base.item,
        channels: [
          { provider: 'instagram', handle: 'momo_insta' },
          { provider: 'threads', handle: 'momo_threads' },
        ],
        imageUrl: 'https://example.com/test.jpg',
      },
      view: {
        ...base.view,
        action: 'PUBLISH' as const,
        actionLabel: '승인하고 발행' as const,
        targetChannelsText: '인스타그램 · 스레드에 올려요',
        targetChannels: ['instagram', 'threads'],
      },
    }

    let retryBody: any = null
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.split('?')[0] === '/api/first-value') return { ok: true, json: async () => dualPublishBase }
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({ accepted: true }) }
      if (url === '/api/first-value/publish') {
        const body = JSON.parse((options?.body as string) || '{}')
        if (body.retryChannel) {
          retryBody = body
          return {
            ok: true,
            json: async () => ({
              verified: true,
              overallStatus: 'ALL_VERIFIED',
              results: [
                { channel: 'instagram', verified: true, permalink: 'https://instagram.com/p/ig1', errorCode: null, status: 'VERIFIED' },
                { channel: 'threads', verified: true, permalink: 'https://threads.net/p/th1', errorCode: null, status: 'VERIFIED' },
              ],
            }),
          }
        }
        return {
          ok: true,
          json: async () => ({
            verified: false,
            overallStatus: 'PARTIAL_SUCCESS',
            results: [
              { channel: 'instagram', verified: true, permalink: 'https://instagram.com/p/ig1', errorCode: null, status: 'VERIFIED' },
              { channel: 'threads', verified: false, permalink: null, errorCode: 'Rate limit', status: 'FAILED' },
            ],
          }),
        }
      }
      throw new Error('unexpected request')
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)

    fireEvent.click(await screen.findByRole('button', { name: '승인하고 발행 · 인스타그램 · 스레드에 올려요' }))
    fireEvent.click(screen.getByRole('button', { name: '네, 발행할게요' }))

    // Partial success card
    expect(await screen.findByText('일부 채널에 첫 소식이 올라갔어요')).toBeInTheDocument()
    expect(screen.getByText('일부 완료')).toBeInTheDocument()

    // Instagram success link
    const igLink = screen.getByRole('link', { name: '게시물 보기' })
    expect(igLink).toHaveAttribute('href', 'https://instagram.com/p/ig1')

    // Threads retry button
    const retryBtn = screen.getByRole('button', { name: '실패한 채널만 다시 시도' })
    expect(retryBtn).toBeInTheDocument()

    // Click retry
    fireEvent.click(retryBtn)
    expect(await screen.findByText('첫 게시물이 올라갔어요')).toBeInTheDocument()
    expect(retryBody).toEqual({
      missionId: dualPublishBase.item.missionId,
      revision: dualPublishBase.item.revision,
      fingerprint: dualPublishBase.item.approvalFingerprint,
      reviewedImageIds: dualPublishBase.item.imageIds,
      retryChannel: 'threads',
    })
  })

  it('renders uncertain result with re-check button when outcome is RESULT_UNKNOWN', async () => {
    const dualPublishBase = {
      ...base,
      item: {
        ...base.item,
        channels: [{ provider: 'instagram', handle: 'momo_insta' }],
      },
      view: {
        ...base.view,
        action: 'PUBLISH' as const,
        actionLabel: '승인하고 발행' as const,
        targetChannelsText: '인스타그램에 올려요',
        targetChannels: ['instagram'],
      },
    }

    const fetcher = vi.fn(async (url: string) => {
      if (url.split('?')[0] === '/api/first-value') return { ok: true, json: async () => dualPublishBase }
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({ accepted: true }) }
      if (url === '/api/first-value/publish') {
        return {
          ok: true,
          json: async () => ({
            verified: false,
            overallStatus: 'RESULT_UNKNOWN',
            results: [
              { channel: 'instagram', verified: false, permalink: null, errorCode: 'Readback pending', status: 'RESULT_UNKNOWN' },
            ],
          }),
        }
      }
      throw new Error('unexpected request')
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)

    fireEvent.click(await screen.findByRole('button', { name: '승인하고 발행 · 인스타그램에 올려요' }))
    fireEvent.click(screen.getByRole('button', { name: '네, 발행할게요' }))

    expect(await screen.findByText('게시 결과를 확인하고 있어요')).toBeInTheDocument()
    expect(screen.getAllByText('확인 중').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: '확인 중 · 다시 확인하기' })).toBeInTheDocument()
  })

  it('renders excluded channel notice when some connected channels are not eligible for publish', async () => {
    const excludedBase = {
      ...base,
      view: {
        ...base.view,
        action: 'PUBLISH' as const,
        actionLabel: '승인하고 발행' as const,
        targetChannelsText: '스레드에 올려요',
        targetChannels: ['threads'],
        excludedChannels: [
          { channel: 'instagram' as const, name: '인스타그램', reason: '사진이 없어 스레드에만 올려요' },
        ],
      },
    }

    const fetcher = vi.fn(async (url: string) => {
      if (url.split('?')[0] === '/api/first-value') return { ok: true, json: async () => excludedBase }
      throw new Error('unexpected request')
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)
    expect(await screen.findByText(/사진이 없어 스레드에만 올려요/)).toBeInTheDocument()
    expect(screen.getByText('인스타그램:')).toBeInTheDocument()
  })

  it('renders reconnect notice and button in tab and excluded channels when CONNECTION_IDENTITY_MISSING', async () => {
    const reconnectBase = {
      ...base,
      item: {
        ...base.item,
        channels: [
          { provider: 'instagram', handle: 'momo_insta' },
          { provider: 'threads', handle: 'momo_threads' },
        ],
        copies: {
          instagram: { caption: '인스타그램 글', hashtags: [] },
          threads: { content: '스레드 글' },
        },
      },
      view: {
        ...base.view,
        action: 'VAULT' as const,
        actionLabel: '승인하고 보관' as const,
        targetChannels: [],
        channelViews: [
          {
            channel: 'instagram' as const,
            name: '인스타그램',
            handle: 'momo_insta',
            contentId: 'c1',
            versionId: 'v1',
            publishAllowed: false,
            publishReason: '이 계정은 다른 곳에서 다시 연결되어 확인이 필요해요. 다시 연결하면 바로 올릴 수 있어요.',
            publishReasonCode: 'CONNECTION_IDENTITY_MISSING',
            reconnectRequired: true,
            reconnectUrl: '/api/channels/instagram/connect?returnPath=/start/preview',
            vaultAllowed: true,
          },
          {
            channel: 'threads' as const,
            name: '스레드',
            handle: 'momo_threads',
            contentId: 'c2',
            versionId: 'v2',
            publishAllowed: false,
            publishReason: '채널을 연결하면 발행할 수 있어요',
            vaultAllowed: true,
          },
        ],
        excludedChannels: [
          {
            channel: 'instagram' as const,
            name: '인스타그램',
            reason: '이 계정은 다른 곳에서 다시 연결되어 확인이 필요해요. 다시 연결하면 바로 올릴 수 있어요.',
            reasonCode: 'CONNECTION_IDENTITY_MISSING',
            reconnectRequired: true,
            reconnectUrl: '/api/channels/instagram/connect?returnPath=/start/preview',
          },
        ],
      },
    }

    const fetcher = vi.fn(async (url: string) => {
      if (url.split('?')[0] === '/api/first-value') return { ok: true, json: async () => reconnectBase }
      throw new Error('unexpected request')
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)

    // 제외 채널 안내 영역의 문구 및 버튼
    expect(await screen.findByText(/다시 연결되어 확인이 필요해요/)).toBeInTheDocument()
    const reconnectLinks = screen.getAllByRole('link', { name: '계정 확인하고 올리기' })
    expect(reconnectLinks.length).toBeGreaterThanOrEqual(1)
    expect(reconnectLinks[0]).toHaveAttribute('href', '/api/channels/instagram/connect?returnPath=/start/preview')

    // 인스타그램 탭에 (연결 확인) 표시 확인
    expect(screen.getByRole('tab', { name: /인스타그램.*연결 확인/ })).toBeInTheDocument()

    // 인스타그램 탭을 누르면 탭 아래에도 연결 확인 안내 박스 노출
    fireEvent.click(screen.getByRole('tab', { name: /인스타그램/ }))
    expect(screen.getByText(/안전한 첫 발행을 위해 계정 연결 확인이 필요해요/)).toBeInTheDocument()
  })

  it('상단 부제: 채널 연결(PUBLISH) 상태면 연결 확인 문구를, 미연결(VAULT) 상태면 기존 문구를, liveRolloutBlocked면 롤아웃 안내 문구를 표시한다', async () => {
    // 1. 미연결 (VAULT)
    const vaultFetcher = vi.fn(async () => ({ ok: true, json: async () => base })) as unknown as typeof fetch
    const { unmount: unmount1 } = render(<FirstValueStudio fetcher={vaultFetcher} />)
    expect(await screen.findByText('첫 글을 확인하는 중이에요. 채널 연결은 나중에 해도 돼요.')).toBeInTheDocument()
    unmount1()

    // 2. 연결 완료 (PUBLISH)
    const publishFetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ...base,
        view: { ...base.view, action: 'PUBLISH' as const, actionLabel: '승인하고 발행' as const },
      }),
    })) as unknown as typeof fetch
    const { unmount: unmount2 } = render(<FirstValueStudio fetcher={publishFetcher} />)
    expect(await screen.findByText('채널 연결이 확인됐어요. 글을 확인하고 승인하면 바로 올라가요.')).toBeInTheDocument()
    unmount2()

    // 3. 롤아웃 차단 (liveRolloutBlocked: true)
    const rolloutBlockedFetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ...base,
        view: {
          ...base.view,
          action: 'VAULT' as const,
          actionLabel: '승인하고 보관' as const,
          liveRolloutBlocked: true,
          liveRolloutNotice: '실제 게시는 곧 열릴 예정이에요. 지금은 글을 보관함에 안전하게 담아 둘게요.',
        },
      }),
    })) as unknown as typeof fetch
    render(<FirstValueStudio fetcher={rolloutBlockedFetcher} />)
    expect(await screen.findByText('실제 게시는 곧 열릴 예정이에요. 지금은 글을 보관함에 담아 둘 수 있어요.')).toBeInTheDocument()
  })

  it('publish failure with WORKSPACE_NOT_IN_LIVE_ROLLOUT renders guidance card without retry button and allows vault fallback', async () => {
    const publishReadyBase = {
      ...base,
      view: {
        ...base.view,
        action: 'PUBLISH' as const,
        actionLabel: '승인하고 발행' as const,
      },
    }

    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.split('?')[0] === '/api/first-value' && !options?.method) return { ok: true, json: async () => publishReadyBase }
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({ accepted: true }) }
      if (url === '/api/first-value/publish') {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            error: '아직 이 계정에서는 실제 게시를 열지 않았어요. 곧 열릴 예정이에요.',
            code: 'WORKSPACE_NOT_IN_LIVE_ROLLOUT',
          }),
        }
      }
      if (url.endsWith('/vault')) {
        return { ok: true, json: async () => ({ saved: [{ channel: 'threads' }], rejected: [], external_posts: 0 }) }
      }
      throw new Error('unexpected request')
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)

    // '승인하고 발행' 클릭 -> 확인 다이얼로그 노출
    fireEvent.click(await screen.findByRole('button', { name: '승인하고 발행' }))
    // '네, 발행할게요' 클릭 -> 서버 403 WORKSPACE_NOT_IN_LIVE_ROLLOUT 에러
    fireEvent.click(screen.getByRole('button', { name: '네, 발행할게요' }))

    // WORKSPACE_NOT_IN_LIVE_ROLLOUT 에러 카드 렌더링 확인
    expect(await screen.findByText('실제 게시는 아직 준비 중이에요')).toBeInTheDocument()
    expect(screen.getByText('아직 이 계정에서는 실제 게시를 열지 않았어요. 곧 열릴 예정이에요.')).toBeInTheDocument()

    // '다시 시도' 버튼은 노출되지 않아야 함
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()

    // 보조 액션: 소희 작업실로 이동 링크
    const toAppSecondary = screen.getByRole('link', { name: '소희 작업실로 이동' })
    expect(toAppSecondary).toHaveAttribute('href', '/app')

    // 주 액션: 보관함에 담기 (vault fallback) 버튼 클릭
    const vaultActionBtn = screen.getByRole('button', { name: '보관함에 담기' })
    fireEvent.click(vaultActionBtn)

    // 보관 완료 카드로 단일 phase 전환 확인
    expect(await screen.findByText('첫 글을 보관함에 담았어요')).toBeInTheDocument()
    expect(screen.queryByText('실제 게시는 아직 준비 중이에요')).not.toBeInTheDocument()
  })

  it('publish failure with FACT_REVIEW_REQUIRED renders review guidance and navigates to content instead of blind retry', async () => {
    const publishReadyBase = {
      ...base,
      view: {
        ...base.view,
        action: 'PUBLISH' as const,
        actionLabel: '승인하고 발행' as const,
      },
    }

    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.split('?')[0] === '/api/first-value' && !options?.method) return { ok: true, json: async () => publishReadyBase }
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({ accepted: true }) }
      if (url === '/api/first-value/publish') {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: '가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.',
            code: 'FACT_REVIEW_REQUIRED',
            reason: 'FACTS_CHANGED',
          }),
        }
      }
      throw new Error('unexpected request')
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)

    fireEvent.click(await screen.findByRole('button', { name: '승인하고 발행' }))
    fireEvent.click(screen.getByRole('button', { name: '네, 발행할게요' }))

    // FACT_REVIEW_REQUIRED 에러 카드 확인
    expect(await screen.findByText('가게 정보를 다시 확인해야 해요')).toBeInTheDocument()
    expect(screen.getByText('가게 정보가 변경되었거나 최신 정보 확인이 필요해요. 원고를 다시 검토해 주세요.')).toBeInTheDocument()

    // blind publish retry가 아니라 원고 재검토 안내 링크 (/app/content)
    const reviewLink = screen.getByRole('link', { name: '원고 다시 검토하기' })
    expect(reviewLink).toHaveAttribute('href', '/app/content')

    // '다시 시도' 버튼이 없음을 확인 (blind publish retry 차단)
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
  })
})

describe('ANI-1599 미연결 사용자의 보관·복사·수동 게시 대안', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetPageActionGuardForTests()
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
    probeState.probe = async (): Promise<boolean> => true
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  })

  it('채널 미연결 VAULT 상태에서 보관·복사 대안이 보이고 게시 완료로 표시되지 않는다', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.split('?')[0] === '/api/first-value') return { ok: true, json: async () => base }
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({ accepted: true }) }
      throw new Error('unexpected request')
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)

    expect(await screen.findByText('연결 전에도 글을 보관하거나 복사할 수 있어요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '글 복사' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '승인하고 보관' })).toBeInTheDocument()
    // 복사는 게시가 아니다: 게시 완료·발행 완료 문구가 없어야 한다
    expect(screen.queryByText('게시 완료')).not.toBeInTheDocument()
    expect(screen.queryByText('발행 완료')).not.toBeInTheDocument()
    expect(screen.queryByText('첫 게시물이 올라갔어요')).not.toBeInTheDocument()
  })

  it('복사를 눌러도 게시 상태가 바뀌지 않고 게시 요청을 보내지 않는다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const fetcher = vi.fn(async (url: string) => {
      if (url.split('?')[0] === '/api/first-value') return { ok: true, json: async () => base }
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({ accepted: true }) }
      throw new Error('unexpected request')
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)
    fireEvent.click(await screen.findByRole('button', { name: '글 복사' }))

    expect(await screen.findByRole('status', { name: '수동 게시 준비 상태' }))
      .toHaveTextContent('글을 복사했어요. 직접 올리기 전이며 게시 여부는 확인되지 않았어요.')
    expect(screen.queryByText('게시 완료')).not.toBeInTheDocument()
    expect(screen.queryByText('첫 게시물이 올라갔어요')).not.toBeInTheDocument()
    const calls = (fetcher as any).mock.calls.map(([url]: [string]) => url)
    expect(calls.some((url: string) => url.includes('/publish'))).toBe(false)
  })

  it('채널 미연결로 막힌 화면에서도 보관·복사·수동 게시 안내와 복사≠게시 고지를 보여준다', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.split('?')[0] === '/api/first-value') {
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: '준비를 완료하면 이용할 수 있어요', code: 'CHANNEL_NOT_CONNECTED' }),
        }
      }
      throw new Error('unexpected request')
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)

    expect(await screen.findByText('연결된 채널이 없어요')).toBeInTheDocument()
    // 대안 안내가 함께 보인다 (막다른 길 금지)
    const alternative = await screen.findByRole('region', { name: '채널 연결 전에 할 수 있는 일' })
    expect(alternative).toHaveTextContent('보관')
    expect(alternative).toHaveTextContent('복사')
    expect(alternative).toHaveTextContent('복사만으로 게시되지는 않아요')
    expect(screen.queryByText('게시 완료')).not.toBeInTheDocument()
  })

  it('준비 미완료로 막히면 채널이 아니라 가게 정보 확인을 안내한다', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.split('?')[0] === '/api/first-value') {
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: '준비를 완료하면 이용할 수 있어요', code: 'PREPARATION_INCOMPLETE' }),
        }
      }
      throw new Error('unexpected request')
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)

    expect(await screen.findByText('가게 정보를 먼저 확인해 주세요')).toBeInTheDocument()
    expect(screen.queryByText('연결된 채널이 없어요')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '가게 정보 확인하기' })).toHaveAttribute('href', '/start')
  })

  it('연결됨 + 발행 가능 상태에서는 미연결 안내 없이 기존 발행 확인 흐름을 유지한다', async () => {
    const publishReady = {
      ...base,
      item: { ...item, channels: [{ provider: 'threads', handle: '@momo' }] },
      view: { ...base.view, action: 'PUBLISH' as const, actionLabel: '승인하고 발행' as const },
    }
    const fetcher = vi.fn(async (url: string) => {
      if (url.split('?')[0] === '/api/first-value') return { ok: true, json: async () => publishReady }
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({ accepted: true }) }
      throw new Error('unexpected request')
    }) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)

    expect(await screen.findByRole('button', { name: '승인하고 발행' })).toBeEnabled()
    expect(screen.queryByText('연결 전에도 글을 보관하거나 복사할 수 있어요')).not.toBeInTheDocument()
  })

  it('renders neutral preparation message during initial loading without asserting unverified image generation or algorithm claims', async () => {
    let resolveLoading: (val: any) => void
    const pendingPromise = new Promise((resolve) => {
      resolveLoading = resolve
    })
    const fetcher = vi.fn(() => pendingPromise) as unknown as typeof fetch

    render(<FirstValueStudio fetcher={fetcher} />)

    expect(screen.getByText('가게 정보와 목표를 확인하는 중')).toBeInTheDocument()
    expect(screen.getByText('사장님이 알려주신 가게 특징을 바탕으로 초안을 준비하고 있어요.')).toBeInTheDocument()
    expect(screen.queryByText('고화질 맞춤 대표 이미지 생성 중')).not.toBeInTheDocument()
    expect(screen.queryByText(/알고리즘에 반응이 좋은/)).not.toBeInTheDocument()

    resolveLoading!({ ok: true, json: async () => base })
  })
})
