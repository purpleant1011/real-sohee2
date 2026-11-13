import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ANI-1744 gate: 예약표 read-model 과 모바일 R2 feature 들의 가게(workspace) 격리 정적 게이트.
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

describe('예약표 repository 격리', () => {
  it('모든 .from() 조회가 workspace_id 로 범위가 한정된다', () => {
    const lines = readFileSync('src/features/schedule/repository.ts', 'utf8').split('\n')
    const froms = lines.map((l, i) => ({ l, i })).filter(({ l }) => /\.from\('/.test(l))
    expect(froms.length).toBeGreaterThan(0)
    const unscoped = froms.filter(({ i }) => !/workspace_id/.test(lines.slice(i, i + 8).join('\n')))
    expect(unscoped.map(u => u.i + 1)).toEqual([])
  })
})

describe('모바일 R2 feature 서버 접근', () => {
  it('src/features/mobile-* 는 service-role(admin) 클라이언트를 직접 쓰지 않는다', () => {
    const dirs = readdirSync('src/features').filter(d => d.startsWith('mobile-')).map(d => join('src/features', d))
    const offenders = dirs.flatMap(d => walk(d)).filter(f => /createAdminSupabaseClient|supabase\/admin|SERVICE_ROLE/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
