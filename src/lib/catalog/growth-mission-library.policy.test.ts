import { describe, it, expect } from 'vitest'
import { GROWTH_MISSION_LIBRARY } from './growth-mission-library'

describe('Growth Mission Library Policy & Copy Audit', () => {
  it('does not contain rank-1, top-3 or automated bot claims', () => {
    // Check category 5 name
    const localDom = GROWTH_MISSION_LIBRARY.filter(m => m.category === 'LOCAL_DOMINANCE')
    expect(localDom.length).toBe(8)
    for (const m of localDom) {
      expect(m.categoryName).not.toContain('플레이스 1위')
    }

    const loc01 = GROWTH_MISSION_LIBRARY.find(m => m.id === 'mission_loc_01')!
    expect(loc01.title).not.toContain('1위 타깃')
    expect(loc01.expectedOutcome).not.toContain('Top 3 진입')

    const nav01 = GROWTH_MISSION_LIBRARY.find(m => m.id === 'mission_nav_01')!
    expect(nav01.expectedOutcome).not.toContain('1페이지 상위 랭킹 선점')

    const daa08 = GROWTH_MISSION_LIBRARY.find(m => m.id === 'mission_daa_08')!
    expect(daa08.title).not.toContain('실시간 상담 자동 응대 가동')
    expect(daa08.description).not.toContain('소희가 3분 내 정중히 답변')

    const com04 = GROWTH_MISSION_LIBRARY.find(m => m.id === 'mission_com_04')!
    expect(com04.expectedOutcome).not.toContain('1페이지 3개 지면 점유')
  })
})
