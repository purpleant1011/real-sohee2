import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { updateFactContent } from '../facts-service'

/**
 * D-6 — `knowledge_facts` and `knowledge_candidates` are joined by TWO foreign keys
 * (`knowledge_facts_source_candidate_fkey` via source_candidate_id, and
 * `knowledge_candidates_conflict_fact_fkey` via conflicts_with_fact_id), so PostgREST
 * answers a bare `knowledge_candidates(...)` embed with PGRST201 and the lookup dies.
 * That made `updateFactContent` fail with "Fact not found" every time, so a catalog price
 * edit never superseded the old Fact (it forked a second active claim instead).
 *
 * These tests fail if anyone reintroduces an unqualified embed.
 */

const WS_ID = 'ws-test-1111-2222-3333-444455556666'
const USER_ID = 'usr-test-1111-2222-3333-444455556666'

interface Captured {
  select?: string
  updatedStatus?: unknown
  insertedFact?: Record<string, unknown>
}

function clientFor(captured: Captured, existingFact: Record<string, unknown> | null) {
  const factChain: any = {
    select: vi.fn().mockImplementation((columns: string) => {
      captured.select = columns
      return factChain
    }),
    eq: vi.fn().mockImplementation(() => factChain),
    maybeSingle: vi.fn().mockResolvedValue({ data: existingFact, error: null }),
    update: vi.fn().mockImplementation((patch: unknown) => {
      captured.updatedStatus = patch
      const chain: any = { eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) }
      return chain
    }),
    insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
      captured.insertedFact = row
      return {
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'fact-new-1', category: row.category, content: row.content, created_at: '2026-10-23T00:00:00Z' },
            error: null,
          }),
        }),
      }
    }),
  }
  const candidateChain: any = {
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'cand-new-1' }, error: null }),
      }),
    }),
  }
  return {
    from: vi.fn().mockImplementation((table: string) =>
      table === 'knowledge_facts' ? factChain : candidateChain),
  }
}

const existingRow = {
  id: 'fact-old-1',
  workspace_id: WS_ID,
  category: 'MENU',
  content: '속눈썹 연장 — 45,000원 · 90분',
  source_candidate_id: 'cand-old-1',
  status: 'active',
  knowledge_candidates: { knowledge_source_id: 'src-1', source_location: 'manual' },
}

describe('updateFactContent — D-6 embed 관계명', () => {
  it('knowledge_candidates embed 에 FK 관계명을 명시한다', async () => {
    const captured: Captured = {}
    await updateFactContent(
      { workspaceId: WS_ID, userId: USER_ID, factId: 'fact-old-1', content: '속눈썹 연장 — 52,000원 · 90분' },
      clientFor(captured, existingRow) as any,
    )

    expect(captured.select).toBeTruthy()
    expect(captured.select).toContain('knowledge_candidates!knowledge_facts_source_candidate_fkey')
  })

  it('관계명 없는 knowledge_candidates embed 를 쓰지 않는다(PGRST201 재발 방지)', async () => {
    const captured: Captured = {}
    await updateFactContent(
      { workspaceId: WS_ID, userId: USER_ID, factId: 'fact-old-1', content: '속눈썹 연장 — 52,000원 · 90분' },
      clientFor(captured, existingRow) as any,
    )

    // A bare `knowledge_candidates (` or `knowledge_candidates(` is exactly what PostgREST rejects.
    expect(captured.select).not.toMatch(/knowledge_candidates\s*\(/)
  })

  it('기존 fact 를 superseded 로 닫고 새 fact 에 supersedes_fact_id 를 잇는다', async () => {
    const captured: Captured = {}
    const result = await updateFactContent(
      { workspaceId: WS_ID, userId: USER_ID, factId: 'fact-old-1', content: '속눈썹 연장 — 52,000원 · 90분' },
      clientFor(captured, existingRow) as any,
    )

    expect(captured.updatedStatus).toMatchObject({ status: 'superseded' })
    expect(captured.insertedFact).toMatchObject({
      supersedes_fact_id: 'fact-old-1',
      status: 'active',
      content: '속눈썹 연장 — 52,000원 · 90분',
    })
    expect(result.id).toBe('fact-new-1')
  })

  it('조회 결과가 없으면 조용히 새 fact 를 만들지 않고 실패를 알린다', async () => {
    const captured: Captured = {}
    await expect(
      updateFactContent(
        { workspaceId: WS_ID, userId: USER_ID, factId: 'missing', content: '내용 변경' },
        clientFor(captured, null) as any,
      ),
    ).rejects.toThrow('Fact not found')
    expect(captured.insertedFact).toBeUndefined()
  })
})

describe('정적 점검 — 저장소에 모호한 knowledge_candidates embed 가 남아 있지 않다', () => {
  const repoRoot = join(process.cwd(), 'src')

  it('src 전체에서 관계명 없는 knowledge_candidates embed 가 0건이다', async () => {
    const { execFileSync } = await import('node:child_process')
    // -F: literal, -n: line numbers, -I: skip binaries.
    let out = ''
    try {
      // Production sources only: this file itself quotes the bad pattern.
      out = execFileSync(
        'grep',
        ['-rnF', '--exclude-dir=__tests__', '--exclude=*.test.ts', '--exclude=*.test.tsx', 'knowledge_candidates (', repoRoot],
        { encoding: 'utf8' },
      )
    } catch (error) {
      // grep exits 1 when there is no match — that is the pass case.
      const code = (error as { status?: number }).status
      if (code !== 1) throw error
      out = ''
    }
    expect(out.trim()).toBe('')
  })

  it('facts-service 는 관계명을 담은 embed 를 실제로 쓴다(파일 문자열 검증)', () => {
    const source = readFileSync(join(repoRoot, 'features/sohee-knowledge/facts-service.ts'), 'utf8')
    expect(source).toContain('knowledge_candidates!knowledge_facts_source_candidate_fkey')
  })
})
