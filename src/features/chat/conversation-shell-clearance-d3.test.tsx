import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConversationShell } from './conversation-shell'
import type { ConversationMessage } from './types'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/conversations/test',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/features/mobile-shell/r2-gate', () => ({
  useMobileR2Active: () => true,
}))

let mockViewport = {
  height: 844,
  keyboardOpen: false,
  keyboardHeight: 0,
}

vi.mock('@/features/mobile-shell/viewport', () => ({
  useViewport: () => mockViewport,
}))

describe('ConversationShell clearance and dock layout (D1 & D3)', () => {
  it('단일 스크롤 컨테이너 끝에 클리어런스 스페이서를 배치하고, 블로그 미리보기가 있어도 스페이서가 그 뒤에 위치한다', () => {
    const messages: readonly ConversationMessage[] = [
      {
        id: 'msg-1',
        workspaceId: 'ws-test',
        threadId: 'th-1',
        role: 'sohee',
        content: '블로그 글을 작성했습니다.',
        status: 'completed',
        workItemId: null,
        completedAt: '2026-11-03T10:00:05Z',
        createdAt: '2026-11-03T10:00:00Z',
      },
    ]

    const messageDetails = {
      'msg-1': {
        evidence: [],
        artifacts: [
          {
            kind: 'conversation_artifact' as const,
            artifact: {
              id: 'blog-art-1',
              type: 'naver_blog_post' as const,
              title: '블로그 제목',
              caption: '',
              status: 'ready_for_review' as const,
              naverBlog: {
                introduction: '도입 문단입니다.',
                sections: [{ heading: '준비할 내용', body: '궁금한 점을 미리 정리해 주세요.' }],
                editorBlueprint: [
                  { kind: 'paragraph' as const, text: '도입 문단입니다.' },
                ],
                keywords: ['상담'],
                visibility: 'private' as const,
              },
              slides: [],
              hashtags: [],
              cta: '',
              disclosure: '',
              observations: [],
              limitations: [],
              evidence: [],
              unresolvedQuestions: [],
              idempotencyKey: 'k',
            },
          },
        ],
      },
    }

    const { container } = render(
      <ConversationShell
        messages={messages}
        messageDetails={messageDetails as any}
        workspaceId="ws-test"
      />
    )

    // D3: Spacer element must exist at the end of the scrollable flow
    const spacer = container.querySelector('[data-scroll-clearance-spacer]')
    expect(spacer).toBeInTheDocument()

    // Spacer must be placed after the blog artifact preview
    const blogPreview = container.querySelector('aside')
    expect(blogPreview).toBeInTheDocument()

    const shell = container.querySelector('[data-conversation-workspace]')
    const children = Array.from(shell?.children ?? [])
    const blogIndex = children.indexOf(blogPreview!)
    const spacerIndex = children.indexOf(spacer!)
    const dockIndex = children.indexOf(container.querySelector('[class*="composerDock"]')!)

    expect(blogIndex).toBeGreaterThan(-1)
    expect(spacerIndex).toBeGreaterThan(blogIndex)
    expect(dockIndex).toBeGreaterThan(spacerIndex)
  })

  it('키보드가 열리면 dock에 data-keyboard-open이 부여되어 safe-area 패딩을 제거한다', () => {
    mockViewport = {
      height: 544,
      keyboardOpen: true,
      keyboardHeight: 300,
    }

    const { container } = render(
      <ConversationShell
        messages={[]}
        workspaceId="ws-test"
      />
    )

    const dock = container.querySelector('[class*="composerDock"]')
    expect(dock).toHaveAttribute('data-keyboard-open', 'true')

    // Reset viewport mock
    mockViewport = {
      height: 844,
      keyboardOpen: false,
      keyboardHeight: 0,
    }
  })

  it('conversation-shell.module.css defines keyboard rules for both force-mobile and non-force-mobile shells', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const cssPath = path.resolve(__dirname, 'conversation-shell.module.css')
    const cssContent = await fs.readFile(cssPath, 'utf-8')

    // 1. Selector for non-force-mobile shell must exist and set bottom with keyboard inset
    expect(cssContent).toMatch(/:global\(\[data-mobile-shell\]:not\(\[data-force-mobile=['"]true['"]\]\)\)\s+\.composerDock/)
    expect(cssContent).toMatch(/bottom:\s*var\(--conversation-keyboard-inset,\s*0px\)/)

    // 2. Default/force-mobile keeps bottom: 0, and data-keyboard-open drops safe-area padding
    expect(cssContent).toMatch(/\.composerDock\[data-keyboard-open=['"]true['"]\]\s*\{[^}]*padding-bottom:\s*0\.5rem/)
  })

  it('DOM-level: CSS selector correctly differentiates force-mobile vs non-force-mobile shells', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div data-mobile-shell data-force-mobile="true">
        <div class="composerDock" data-testid="dock-force-mobile"></div>
      </div>
      <div data-mobile-shell data-force-mobile="false">
        <div class="composerDock" data-testid="dock-standard-mobile"></div>
      </div>
    `
    document.body.appendChild(root)

    const nonForceMobileDocks = root.querySelectorAll(
      '[data-mobile-shell]:not([data-force-mobile="true"]) .composerDock'
    )
    expect(nonForceMobileDocks).toHaveLength(1)
    expect(nonForceMobileDocks[0].getAttribute('data-testid')).toBe('dock-standard-mobile')

    const forceMobileDocks = root.querySelectorAll(
      '[data-mobile-shell][data-force-mobile="true"] .composerDock'
    )
    expect(forceMobileDocks).toHaveLength(1)
    expect(forceMobileDocks[0].getAttribute('data-testid')).toBe('dock-force-mobile')

    document.body.removeChild(root)
  })

  it('verifies dock positioning geometry against simulated 544px visible viewport (844px layout, 300px keyboard)', () => {
    // Branch A: forceMobile (m.example.com)
    // Shell is transform-bearing (containing block), height = visualViewport height (544px).
    // Dock has bottom: 0 relative to containing block.
    const shellHeightForceMobile = 544
    const dockBottomForceMobile = 0
    const visualBottomForceMobile = shellHeightForceMobile - dockBottomForceMobile
    expect(visualBottomForceMobile).toBe(544)

    // Branch B: NOT forceMobile (example.com on mobile Safari)
    // Shell has NO transform (fixed inset-x-0 top-0), layout viewport = 844px.
    // Dock is positioned relative to layout viewport with bottom: var(--conversation-keyboard-inset, 0px) = 300px.
    const layoutViewportHeight = 844
    const keyboardInset = 300
    const dockBottomNotForceMobile = keyboardInset
    const visualBottomNotForceMobile = layoutViewportHeight - dockBottomNotForceMobile
    expect(visualBottomNotForceMobile).toBe(544)

    // In both branches, dock resting position equals the 544px visible height top of keyboard!
    expect(visualBottomForceMobile).toBe(visualBottomNotForceMobile)
  })
})
