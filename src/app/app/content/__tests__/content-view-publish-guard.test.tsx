// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DUPLICATE_WRITE_COPY, OFFLINE_WRITE_COPY } from '@/features/pwa/action-guard'
import { resetPageActionGuardForTests } from '@/features/pwa/external-write'

/**
 * 레거시 승인·발행 화면(/app/content)의 발행 가드 (ANI-1778).
 * 이 화면은 셸·파이프라인·스튜디오를 모두 품고 있어, 여기서는 발행 진입점만 남기고
 * 나머지는 비운다 — 가드가 버튼에서 실제로 배선됐는지만 본다.
 */
vi.mock('@/components/v088/layout/v088-app-shell', () => ({
  V088AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/agent-os/sohee-live-workboard', () => ({ SoheeLiveWorkboard: () => null }))
vi.mock('@/components/v088/content/content-production-pipeline', () => ({ ContentProductionPipeline: () => null }))
vi.mock('@/components/content/content-studio-renewal', () => ({ ContentStudioRenewal: () => null }))
vi.mock('@/components/v088/calendar/marketing-calendar', () => ({ MarketingCalendar: () => null }))
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src?: string; alt?: string }
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />
  },
}))
vi.mock('@/hooks/use-workspace-context', () => ({ useWorkspaceId: () => 'ws-1' }))
vi.mock('@/hooks/use-credit-balance', () => ({
  useCreditBalance: () => ({ balance: 500, consumeCredits: vi.fn() }),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}))
vi.mock('@/components/v088/content/content-detail-modal', () => ({
  ContentDetailModal: ({
    content,
    onPublishNow,
  }: {
    content: { id: string }
    onPublishNow: (id: string) => void
  }) => (
    <div role="dialog" aria-label="콘텐츠 상세">
      <button type="button" onClick={() => onPublishNow(content.id)}>
        발행하기
      </button>
    </div>
  ),
}))

import ContentPage from '../content-view'

const CONTENT_ITEM = {
  id: 'content-1',
  workspaceId: 'ws-1',
  channel: 'instagram',
  title: '가을 룩북',
  caption: '가을 신상 안내',
  status: 'draft',
  isApproved: true,
  versionId: 'version-1',
  fingerprint: 'fp-1',
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const fetchSpy = vi.fn()

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

beforeEach(() => {
  fetchSpy.mockReset()
  vi.stubGlobal('fetch', fetchSpy)
  setOnLine(true)
  resetPageActionGuardForTests()
  fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/manifest.webmanifest')) return jsonResponse(200, {})
    if (url.includes('/content?') && !init?.method) return jsonResponse(200, { contents: [CONTENT_ITEM] })
    return jsonResponse(200, {})
  })
})

afterEach(() => vi.unstubAllGlobals())

/** 발행 모달까지 연다. 기본 화면은 스튜디오라 레거시 파이프라인으로 먼저 바꾼다. */
async function openPublishAction() {
  render(<ContentPage />)
  fireEvent.click(await screen.findByRole('button', { name: '기존 상세 파이프라인/캘린더' }))
  fireEvent.click(await screen.findByText('가을 룩북'))
  return screen.findByRole('button', { name: '발행하기' })
}

describe('레거시 승인·발행 화면의 외부 쓰기 가드', () => {
  it('오프라인이면 발행 요청을 내보내지 않고 이유를 보여 준다', async () => {
    const publish = await openPublishAction()

    setOnLine(false)
    fireEvent.click(publish)

    expect(await screen.findByText(OFFLINE_WRITE_COPY)).toBeInTheDocument()
    const posts = fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(posts).toHaveLength(0)
  })

  it('발행이 진행 중이면 두 번째 클릭은 요청을 보내지 않는다', async () => {
    const publish = await openPublishAction()

    let finishPublish: (() => void) | null = null
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/manifest.webmanifest')) return jsonResponse(200, {})
      if (url.includes('/publishing/instant')) {
        return new Promise<Response>((resolve) => {
          finishPublish = () => resolve(jsonResponse(200, { results: { instagram: { success: true } } }))
        })
      }
      return jsonResponse(200, {})
    })

    fireEvent.click(publish)
    await waitFor(() =>
      expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/publishing/instant'))).toBe(true),
    )

    fireEvent.click(publish)

    expect(await screen.findByText(DUPLICATE_WRITE_COPY)).toBeInTheDocument()
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('/publishing/instant'))).toHaveLength(1)

    finishPublish!()
  })
})
