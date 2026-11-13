import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/use-workspace-context', () => ({ useWorkspaceId: () => 'ws-test' }))
vi.mock('@/features/plugins/LiveChatToolbeltBar', () => ({
  LiveChatToolbeltBar: () => <div data-testid="toolbelt" />,
}))
// 외부 쓰기 가드는 실제 연결 확인(probe)을 거친다. 이 스위트는 발행 흐름을 보는 것이므로
// probe 는 통과로 고정하고, 오프라인 케이스는 navigator 힌트로 만든다(ANI-1778).
vi.mock('@/features/pwa/network', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/pwa/network')>()
  return { ...actual, probeConnectivity: async () => true }
})

import { OFFLINE_WRITE_COPY } from '@/features/pwa/action-guard'
import { resetPageActionGuardForTests } from '@/features/pwa/external-write'
import { V086ConversationWorkspace } from './v086-conversation-workspace'

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

const chatReply = {
  content: '이미지와 원고를 준비했어요.',
  contentId: 'content-1',
  versionId: 'version-1',
  visualImage: { assetId: 'asset-1', prompt: '신메뉴 사진' },
  preview: { title: '신메뉴 소개', caption: '이번 주 신메뉴예요', hashtags: ['#신메뉴'] },
}

function stubFetch() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/agent/session')) return { ok: true, json: async () => ({ session: { threadId: 'thread-1', title: '대화' } }) }
    if (url.includes('/conversations/')) return { ok: true, json: async () => ({ data: [] }) }
    if (url.endsWith('/agent/chat') && init?.method === 'POST') return { ok: true, json: async () => chatReply }
    if (url.endsWith('/content/approvals')) return { ok: true, json: async () => ({ success: true }) }
    return { ok: true, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** 대화 응답으로 크리에이티브 카드가 붙은 메시지를 만들고, 승인까지 마친다. */
async function reachPublishButton() {
  render(<V086ConversationWorkspace />)
  fireEvent.change(screen.getByPlaceholderText('소희에게 마케팅 업무를 지시하세요...'), { target: { value: '신메뉴 홍보해줘' } })
  fireEvent.click(screen.getByRole('button', { name: '보내기' }))
  fireEvent.click(await screen.findByRole('button', { name: /이 원고 \+ 이 이미지 승인/ }))
  return screen.findByRole('button', { name: /지금 바로 채널에 게시/ })
}

beforeEach(() => {
  setOnLine(true)
  resetPageActionGuardForTests()
})

describe('V086ConversationWorkspace 외부 쓰기 가드 (ANI-1778)', () => {
  it('오프라인이면 지금 발행 요청을 보내지 않고 안내를 남긴다', async () => {
    const fetchMock = stubFetch()
    const publishButton = await reachPublishButton()

    setOnLine(false)
    fireEvent.click(publishButton)

    expect(await screen.findByText(OFFLINE_WRITE_COPY)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/publishing/jobs') && (init as RequestInit | undefined)?.method === 'POST')).toBe(false)
  })

  it('연결되어 있으면 지금 발행 요청을 한 번만 보낸다', async () => {
    const fetchMock = stubFetch()
    const publishButton = await reachPublishButton()

    fireEvent.click(publishButton)
    fireEvent.click(publishButton)

    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/publishing/jobs'))).toHaveLength(1))
    expect(screen.queryByText(OFFLINE_WRITE_COPY)).not.toBeInTheDocument()
  })
})
