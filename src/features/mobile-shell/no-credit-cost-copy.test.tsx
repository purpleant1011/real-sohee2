import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MobileR2Provider } from './r2-gate'
import { MagicPhotoDropzone } from '@/components/home-today/magic-photo-dropzone'
import { ResearchPlanCard } from '@/features/chat/research-plan-card'
import { BlogStrategyCard } from '@/features/chat/blog-strategy-card'
import { CreditEstimateCard } from '@/features/credits/credit-estimate-card'
import { ConversationRuleCard } from '@/features/automation/conversation-rule-card'

const push = vi.hoisted(() => vi.fn())
const context = vi.hoisted(() => ({
  workspaceId: '10000000-0000-4000-8000-000000000001',
  membershipRole: 'owner',
  actorId: '20000000-0000-4000-8000-000000000001',
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/hooks/use-workspace-context', () => ({ useOptionalWorkspaceContext: () => context }))

const ROOT = join(__dirname, '..', '..', '..')
const SRC = join(ROOT, 'src')
const BANNED_COPY = /\d+\s*크레딧|크레딧\s*소모|크레딧\s*차감/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      walk(full, out)
    } else if (/\.(tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

/**
 * 모바일 화면에서 명시적인 요금·원장 화면(Billing/Ledger)을 제외한 모든 UI는
 * "몇 크레딧 소모", "크레딧 차감", "N 크레딧" 등의 문구를 노출할 수 없다.
 */
const BILLING_ALLOWLIST = new Set<string>([])

describe('모바일 크레딧 소모 문구 방지 가드 (Static Scan)', () => {
  const mobileDirs = readdirSync(join(SRC, 'features'))
    .filter((name) => name.startsWith('mobile-'))
    .map((name) => join(SRC, 'features', name))

  const allMobileFiles = mobileDirs
    .flatMap((dir) => walk(dir))
    .map((f) => ({ f, rel: relative(ROOT, f) }))

  const offenders = allMobileFiles
    .filter(({ f }) => BANNED_COPY.test(readFileSync(f, 'utf8')))
    .map(({ rel }) => rel)

  it('허용된 결제/요금 관리 화면 외에는 소모/차감/숫자 크레딧 문구가 없어야 한다', () => {
    const unallowed = offenders.filter((rel) => !BILLING_ALLOWLIST.has(rel))
    expect(unallowed).toEqual([])
  })

  it('허용 목록의 파일은 실제로 허용 패턴을 포함해야 한다 (오래된 허용목록 방지)', () => {
    const set = new Set(offenders)
    expect([...BILLING_ALLOWLIST].filter((r) => !set.has(r))).toEqual([])
  })
})

describe('모바일 컴포넌트 렌더링 시 크레딧 소모 문구 노출 차단 (Runtime Guard)', () => {
  it('MagicPhotoDropzone: 모바일에서 크레딧 수치 및 문안 제작 크레딧 안내 없이 "원고 준비" 버튼만 노출', async () => {
    const photoId = '60000000-0000-4000-8000-000000000001'
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/onboarding/media')) return Response.json(init?.method === 'POST' ? { selected: true } : { items: [{ id: photoId, rights_status: 'confirmed', publish_eligibility: true }] })
      if (url.includes('/quick-post?limit=1')) return Response.json({ credits: { photoDraftCost: 100 } })
      return Response.json({})
    })

    const { container } = render(
      <MobileR2Provider enabled={true} forceMobile={true}>
        <MagicPhotoDropzone workspaceId={context.workspaceId} fetcher={fetcher} />
      </MobileR2Provider>,
    )

    const openBtn = screen.getByRole('button', { name: /사진으로 글 만들기/ })
    fireEvent.click(openBtn)
    fireEvent.click(await screen.findByRole('button', { name: '이 사진 선택' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '글 초안 만들기' })).toBeEnabled())

    // 모바일 렌더링 결과에 크레딧 소모/숫자 패턴이 없어야 함
    expect(container.textContent).not.toMatch(BANNED_COPY)
    expect(container.textContent).not.toContain('문안 제작은 최대 100 크레딧이에요')
    expect(screen.queryByRole('button', { name: /크레딧 이내로 원고 준비/ })).toBeNull()
  })

  it('ResearchPlanCard: 모바일에서 예상 필요 크레딧 및 태스크별 크레딧이 노출되지 않음', () => {
    const samplePlan = {
      summary: '인스타그램 홍보 계획',
      direction: ['방향 1'],
      tasks: [
        { id: 't1', title: '블로그 키워드 분석', channel: 'naver_blog', estimatedCredits: 5 },
      ],
      totalCredits: 10,
    }

    const { container } = render(
      <MobileR2Provider enabled={true} forceMobile={true}>
        <ResearchPlanCard plan={samplePlan} />
      </MobileR2Provider>,
    )

    expect(container.textContent).not.toMatch(BANNED_COPY)
    expect(screen.queryByText('예상 필요 크레딧')).toBeNull()
    expect(screen.queryByText(/10 크레딧/)).toBeNull()
    expect(screen.queryByText(/5 크레딧/)).toBeNull()
  })

  it('CreditEstimateCard: 모바일에서 실행 가능 상태일 때 크레딧 견적 카드를 숨김', () => {
    const artifact = {
      id: 'art-1',
      catalogVersion: 1,
      estimatedCredits: 68,
      availableCredits: 124,
      expectedRemainingCredits: 56,
      status: 'ready' as const,
      adjustments: [],
    }

    const { container } = render(
      <MobileR2Provider enabled={true} forceMobile={true}>
        <CreditEstimateCard artifact={artifact} />
      </MobileR2Provider>,
    )

    expect(container.textContent).not.toMatch(BANNED_COPY)
    expect(screen.queryByText(/68 크레딧/)).toBeNull()
  })

  it('CreditEstimateCard: 모바일에서 부족 상태일 때 숫자 없이 "이용 한도에 도달했어요"만 표시', () => {
    const artifact = {
      id: 'art-2',
      catalogVersion: 1,
      estimatedCredits: 120,
      availableCredits: 20,
      expectedRemainingCredits: -100,
      status: 'insufficient' as const,
      adjustments: [{ kind: 'reduce_images' as const, label: '게시물 수를 줄여보세요' }],
    }

    const { container } = render(
      <MobileR2Provider enabled={true} forceMobile={true}>
        <CreditEstimateCard artifact={artifact} />
      </MobileR2Provider>,
    )

    expect(container.textContent).not.toMatch(BANNED_COPY)
    expect(screen.getByText('이용 한도에 도달했어요')).toBeInTheDocument()
    expect(screen.getByText('게시물 수를 줄여보세요')).toBeInTheDocument()
    expect(container.textContent).not.toContain('100 크레딧 부족')
  })

  it('ConversationRuleCard: 모바일에서 실행 비용/한도 크레딧이 노출되지 않음', () => {
    const proposal = {
      name: '아침 성과 보고',
      schedule: '매일 오전 9:00',
      timezone: 'Asia/Seoul',
      channels: ['인스타그램'],
      perRunCreditCap: 20,
      dailyCreditCap: 40,
      weeklyCreditCap: 200,
      quietHours: { start: '22:00', end: '07:00' },
      active: false,
    }

    const { container } = render(
      <MobileR2Provider enabled={true} forceMobile={true}>
        <ConversationRuleCard proposal={proposal} />
      </MobileR2Provider>,
    )

    expect(container.textContent).not.toMatch(BANNED_COPY)
    expect(screen.queryByText(/40 크레딧/)).toBeNull()
  })

  it('BlogStrategyCard: 모바일에서 크레딧 차감 및 요청 크레딧 수치가 노출되지 않음', async () => {
    const proposal = {
      id: '10000000-0000-4000-8000-000000000001',
      revision: 1,
      status: 'proposed' as const,
      topics: [{ title: '주제 1', evidence: ['근거 1'], questionSource: 'inferred' as const }],
      goal: { description: '상담 문의' },
      unknowns: [],
      selectedIndex: null,
      audience: '고객',
      constraints: '',
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ data: proposal, generationCredits: 30 }))

    const { container } = render(
      <MobileR2Provider enabled={true} forceMobile={true}>
        <BlogStrategyCard workspaceId="ws-test" threadId="th-test" onGenerate={vi.fn()} />
      </MobileR2Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '블로그 주제 정하기' }))
    await screen.findByText('원고와 이미지를 준비할 수 있어요. 실행 직전 적용 기준을 다시 확인해요.')

    expect(container.textContent).not.toMatch(BANNED_COPY)
    expect(screen.queryByText(/30크레딧/)).toBeNull()
    expect(screen.queryByText(/크레딧 차감/)).toBeNull()
  })
})
